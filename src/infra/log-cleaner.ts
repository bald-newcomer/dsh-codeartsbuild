/**
 * 日志清洗器 — 将原始构建日志清洗为结构化模型
 * 对齐 FE-02-日志清洗器规范-20260918.md（§4 处理流水线 / §5 错误分类 / §8 安全脱敏）
 *
 * 输入为解压后的纯文本（get_log 工具层完成 ZIP 解压）；根因分析交给 LLM。
 */
import { ToolException } from '../core/types.js';

/** 清洗输入 */
export interface CleanLogInput {
  rawLog: string;
  /** 截断上限（字节，默认 256 KB） */
  maxBytes?: number;
  /** 是否优先提取错误段 */
  errorFocus?: boolean;
}

/** 清洗输出 Schema（FE-02-日志清洗器规范-20260918.md §3.2） */
export interface CleanLogResult {
  job_key: string | null;
  resource_pool: string | null;
  byte_size: number;
  truncated: boolean;
  raw_sample: string;
  steps: Array<{ name: string; substep: string; status: string; line_range: [number, number] }>;
  structured: Array<{
    phase: string;
    step: string | null;
    level: string;
    content: string;
    line: number;
    error_type: string;
    error_code: string | null;
  }>;
  error_summary: {
    phase: string;
    step: string | null;
    error_type: string;
    error_code: string | null;
    message: string;
    line: number;
    context: string;
  } | null;
  finished: string | null;
  task_states: Array<{ state: string; status: string }>;
}

/** 行格式：`[时间戳] [级别] [步骤标识] : 内容`（FE-02-日志清洗器规范-20260918.md §2.1） */
interface LogLine {
  line: number;
  level: string;
  step: string | null;
  content: string;
}

/** 错误分类表（FE-02-日志清洗器规范-20260918.md §5.1，优先级从高到低） */
const ERROR_CLASSIFIERS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'DOCKER_BUILD_FAILED', pattern: /docker build|docker command failed|unable to prepare context|BuildDockerException|Docker build image failed/i },
  { type: 'DOCKER_PULL_FAILED', pattern: /docker pull|pull access denied|manifest unknown|Get .*: denied/i },
  { type: 'COMPILE_ERROR', pattern: /cannot find symbol|COMPILATION ERROR|error:|symbol: class/i },
  { type: 'DEPENDENCY_MISSING', pattern: /Could not resolve|dependency not found|cannot resolve|404.*(repo|repository)|Could not find artifact/i },
  { type: 'TEST_FAILURE', pattern: /Tests run:.*Failures|BUILD FAILURE.*(test|surefire)|There were test failures/i },
  { type: 'TIMEOUT', pattern: /timed? out|TimeoutException|exceeded the timeout|timeout check/i },
  { type: 'OOM', pattern: /OutOfMemoryError|\bKilled\b|memory limit|heap space/i },
  { type: 'PERMISSION_DENIED', pattern: /\b403\b|\bForbidden\b|Permission denied|unauthorized|Access denied/i },
  { type: 'SCRIPT_ERROR', pattern: /Command exited with|script returned exit code|Step failed|exit code \d+/i },
  { type: 'LOGIN_FAILED', pattern: /login failed|unauthorized.*registry/i },
];

/** CodeArtsBuild 错误码：DEV.CB.0210043 等 */
const ERROR_CODE_RE = /\b[A-Z]{2,}\.[A-Z]{2,}\.\d{4,}\b/;

/** 脱敏规则（FE-02-日志清洗器规范-20260918.md §8） */
const SANITIZERS: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /AKID[0-9A-Za-z]{16,}/g, replace: '***' },
  { pattern: /SKID[0-9A-Za-z]{16,}/g, replace: '***' },
  { pattern: /authorization:\s*Bearer\s+\S+/gi, replace: 'authorization: Bearer ***' },
  { pattern: /x-auth-token:\s*\S+/gi, replace: 'x-auth-token: ***' },
  { pattern: /docker login -u \S+ -p \S+/g, replace: 'docker login -u *** -p ***' },
  { pattern: /(passwd|password)=[^\s,;]+/gi, replace: '$1=***' },
];

/** 解析日志行为结构化行（容忍缺时间戳/缺步骤标识的简式行） */
function parseLines(raw: string): LogLine[] {
  const levelRe = /\[(INFO|WARNING|DEBUG|ERROR|INTERNAL)\]/i;
  const lines: LogLine[] = [];
  for (const [i, line] of raw.split(/\r?\n/).entries()) {
    const lineNo = i + 1;
    // 无级别标记（框架/命令输出行，如 Finished: FAILURE / + docker pull）→ plain
    const levelMatch = line.match(levelRe);
    if (!levelMatch) {
      lines.push({ line: lineNo, level: 'plain', step: null, content: line });
      continue;
    }
    // 级别标记后的可选步骤标识 [step:substep]
    const afterLevel = line.slice((levelMatch.index ?? 0) + levelMatch[0].length);
    const stepMatch = afterLevel.match(/^\s*\[([^\]]+)\]\s*/);
    const step = stepMatch ? stepMatch[1] : null;
    let content = stepMatch ? afterLevel.slice(stepMatch[0].length) : afterLevel;
    content = content.replace(/^\s*:\s*/, '').trim();
    lines.push({ line: lineNo, level: levelMatch[1].toLowerCase(), step, content });
  }
  return lines;
}

/** 按类型分类错误行（§5.2：首个命中类型） */
function classifyError(content: string): string {
  for (const c of ERROR_CLASSIFIERS) {
    if (c.pattern.test(content)) return c.type;
  }
  return 'UNKNOWN';
}

/** 步骤分段：`This step is start/complete` 成对（§4.4） */
function extractSteps(lines: LogLine[]): CleanLogResult['steps'] {
  const steps: CleanLogResult['steps'] = [];
  let current: { name: string; substep: string; start: number } | null = null;

  for (const line of lines) {
    if (/this step is start/i.test(line.content)) {
      const [name, substep] = (line.step ?? '').split(':');
      current = { name: name || line.step || 'unknown', substep: substep || name || line.step || 'unknown', start: line.line };
    } else if (/this step is complete/i.test(line.content) && current) {
      steps.push({
        name: current.name,
        substep: current.substep,
        status: 'success',
        line_range: [current.start, line.line],
      });
      current = null;
    }
  }
  // 未闭合步骤（错误中断）→ status=error
  if (current) {
    steps.push({ name: current.name, substep: current.substep, status: 'error', line_range: [current.start, lines.length] });
  }
  return steps;
}

/** 状态汇总：`All Tasks Status` 块内 state/status（§4.7） */
function extractTaskStates(lines: LogLine[]): CleanLogResult['task_states'] {
  const states: CleanLogResult['task_states'] = [];
  let inBlock = false;
  for (const line of lines) {
    if (/All Tasks Status/i.test(line.content)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^\+{10,}$/.test(line.content.trim())) {
      inBlock = false;
      continue;
    }
    if (inBlock) {
      const m = line.content.match(/state:\s*(\S+),\s*status:\s*(\w+)/);
      if (m) states.push({ state: m[1], status: m[2].toLowerCase() });
    }
  }
  return states;
}

/** 三区采样（§4.3）：HEAD 10% + ERROR 前后 20 行 + TAIL 30% */
function sampleZones(lines: LogLine[], raw: string, maxBytes: number): { sample: string; truncated: boolean } {
  const byteSize = Buffer.byteLength(raw, 'utf-8');
  if (byteSize <= maxBytes) return { sample: raw, truncated: false };

  const total = lines.length;
  const headEnd = Math.max(1, Math.floor(total * 0.1));
  const tailStart = Math.max(headEnd + 1, total - Math.floor(total * 0.3));

  const errorLines = lines.filter((l) => l.level === 'error').map((l) => l.line);
  const ranges: Array<[number, number]> = [[1, headEnd], [tailStart, total]];
  if (errorLines.length > 0) {
    const first = Math.max(1, errorLines[0] - 20);
    const last = Math.min(total, errorLines[errorLines.length - 1] + 20);
    ranges.push([first, last]);
  }
  // 合并重叠区间，按起始排序
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && r[0] <= prev[1] + 1) prev[1] = Math.max(prev[1], r[1]);
    else merged.push([...r] as [number, number]);
  }
  const sampleLines = merged.map(([s, e]) => lines.slice(s - 1, e).map((l) => `[line ${l.line}] ${l.content}`)).join('\n');
  return { sample: sampleLines.slice(0, maxBytes), truncated: true };
}

/** 脱敏（§8） */
export function sanitize(text: string): string {
  let out = text;
  for (const s of SANITIZERS) out = out.replace(s.pattern, s.replace);
  return out;
}

/**
 * 清洗日志（核心入口）
 */
export function cleanLog(input: CleanLogInput): CleanLogResult {
  if (!input.rawLog || input.rawLog.length === 0) {
    return {
      job_key: null,
      resource_pool: null,
      byte_size: 0,
      truncated: false,
      raw_sample: '',
      steps: [],
      structured: [],
      error_summary: null,
      finished: null,
      task_states: [],
    };
  }

  const maxBytes = input.maxBytes ?? 262_144;
  const raw = input.rawLog;
  const lines = parseLines(raw);
  const byteSize = Buffer.byteLength(raw, 'utf-8');

  // ① 元信息
  const jobKeyMatch = raw.match(/\b(j_[A-Za-z0-9]+)\b/);
  const poolMatch = raw.match(/resources pool message:\s*(\S+)/);
  const job_key = jobKeyMatch?.[1] ?? null;
  const resource_pool = poolMatch?.[1] ?? null;

  // ② 体积判定 + ③ 三区采样
  const { sample, truncated } = sampleZones(lines, raw, maxBytes);

  // ④ 步骤分段
  const steps = extractSteps(lines);

  // ⑤⑥ 级别分类 + 错误提取
  const structured: CleanLogResult['structured'] = [];
  for (const line of lines) {
    if (line.level === 'error' || (line.level === 'warn' && input.errorFocus !== false)) {
      const content = sanitize(line.content.slice(0, 500));
      const codeMatch = content.match(ERROR_CODE_RE);
      structured.push({
        phase: 'build',
        step: line.step,
        level: line.level,
        content,
        line: line.line,
        error_type: classifyError(content),
        error_code: codeMatch?.[0] ?? null,
      });
    }
  }

  // 错误摘要：行号最小的 error 级行（§5.2/§5.3）
  let error_summary: CleanLogResult['error_summary'] = null;
  const errorRows = structured.filter((s) => s.level === 'error').sort((a, b) => a.line - b.line);
  if (errorRows.length > 0) {
    const top = errorRows[0];
    const idx = lines.findIndex((l) => l.line === top.line);
    const contextLines = lines.slice(Math.max(0, idx - 2), idx + 3).map((l) => l.content);
    error_summary = {
      phase: top.phase,
      step: top.step,
      error_type: top.error_type,
      error_code: top.error_code,
      message: top.content,
      line: top.line,
      context: sanitize(contextLines.join('\n')),
    };
  }

  // ⑦ 状态汇总
  const finishedMatch = [...raw.matchAll(/Finished:\s*(\w+)/g)].pop();
  const finished = finishedMatch?.[1] ?? null;
  const task_states = extractTaskStates(lines);

  return {
    job_key,
    resource_pool,
    byte_size: byteSize,
    truncated,
    raw_sample: sanitize(sample),
    steps,
    structured,
    error_summary,
    finished,
    task_states,
  };
}
