/**
 * codeartsbuild_repo_build 工具 handler（本地构建域唯一工具）
 * 对齐 api-contract.md §2.16 + FE-01-本地代码仓构建流程设计-20260919.md §4
 *
 * 内部步骤：
 * ① fs 探测仓库类型（repoType 未传时自动）
 * ② 编译指导（参考命令 + 注意点，供模型决策）
 * ③ child_process.spawn 执行编译（stdout/stderr 尾部各 4KB，退出码判定）
 * ④ 失败时正则匹配 stderr 分类异常
 * ⑤ 成功后扫描产物（target/*.jar / dist/* / build/*）
 * ⑥ 自动留档 .codeartsbuild/build-records/
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import { probeRepo, type ProbeResult } from './probe.js';
import { buildGuidance, recommendedSteps } from './guidance.js';
import { scanArtifacts, type LocalArtifact } from './artifact.js';
import { archiveBuild } from './archive.js';

/** 工具入参 */
export interface RepoBuildHandlerInput {
  repoPath: string;
  repoType?: string;
  buildCommandHint?: string;
  timeoutMs?: number;
}

/** 输出尾部截断大小（各 4KB） */
const TAIL_BYTES = 4096;
/** 默认超时 30 分钟 */
const DEFAULT_TIMEOUT_MS = 1_800_000;

/** 失败异常分类（FE-01-本地代码仓构建流程设计-20260919.md §5.1） */
interface BuildError {
  error_type: string;
  error_code: string | null;
  message: string;
  context: string;
}

const ERROR_CLASSIFIERS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'DEPENDENCY_MISSING', pattern: /Could not resolve|dependency not found|module not found|npm ERR! code ENOENT/i },
  { type: 'TOOL_MISSING', pattern: /command not found|is not recognized|not recognized as an internal/i },
  { type: 'COMPILE_ERROR', pattern: /cannot find symbol|COMPILATION ERROR|error:/i },
  { type: 'TEST_FAILURE', pattern: /Tests run:.*Failures|BUILD FAILURE|There were test failures/i },
  { type: 'TIMEOUT', pattern: /timed? out|TimeoutException|exceeded/i },
  { type: 'OOM', pattern: /OutOfMemoryError|\bKilled\b|memory limit|heap space/i },
  { type: 'NETWORK', pattern: /ECONNREFUSED|ETIMEDOUT|network error|Could not transfer|connection failed/i },
];

/** 执行编译命令（shell，捕获 stdout/stderr 尾部） */
async function runBuild(
  command: string,
  repoPath: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdoutTail: string; stderrTail: string; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: repoPath, shell: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new ToolException('E_TIMEOUT', `编译超时（${Math.round(timeoutMs / 1000)}s）`, { command }));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
      if (stdout.length > TAIL_BYTES * 2) stdout = stdout.slice(-TAIL_BYTES * 2);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
      if (stderr.length > TAIL_BYTES * 2) stderr = stderr.slice(-TAIL_BYTES * 2);
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdoutTail: stdout.slice(-TAIL_BYTES), stderrTail: stderr.slice(-TAIL_BYTES), output: stdout + stderr });
    });
  });
}

/** 失败分类（§5.1：stderr 正则匹配） */
function classifyError(stderrTail: string, output: string): BuildError {
  const text = stderrTail || output;
  for (const c of ERROR_CLASSIFIERS) {
    const m = text.match(c.pattern);
    if (m) {
      const idx = text.indexOf(m[0]);
      const context = text.slice(Math.max(0, idx - 100), idx + 200);
      return { error_type: c.type, error_code: null, message: m[0], context };
    }
  }
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return { error_type: 'UNKNOWN', error_code: null, message: first.slice(0, 200), context: '' };
}

/**
 * repo_build 工具 handler
 */
export async function repoBuildHandler(input: RepoBuildHandlerInput): Promise<ToolResult> {
  try {
    // ① 参数校验
    if (!input.repoPath || input.repoPath.trim().length === 0) {
      throw new ToolException('E_PARAM', 'repoPath 为空');
    }
    const repoPath = path.resolve(input.repoPath);
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // ② 探测仓库类型
    const probe: ProbeResult = probeRepo(repoPath, input.repoType);

    // ③ 编译指导
    const guidance = buildGuidance(probe, input.buildCommandHint);
    const buildCommand = input.buildCommandHint ?? guidanceCommand(probe);
    if (!buildCommand) {
      throw new ToolException('E_PARAM', '无法确定编译命令', '请传 buildCommandHint，或确认仓库类型被支持（maven/gradle/npm/go/python/php/cmake/msbuild/docker）');
    }

    // ④ 执行编译
    const started = Date.now();
    const { exitCode, stdoutTail, stderrTail, output } = await runBuild(buildCommand, repoPath, timeoutMs);
    const durationSeconds = Math.round((Date.now() - started) / 1000);
    const recordId = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+/, '');

    // ⑤ 结果判定：退出码 + 输出关键字（FE-01-本地代码仓构建流程设计-20260919.md §4.2）
    const successKeyword = /BUILD SUCCESS|Finished: SUCCESS|success in/i.test(output);
    const failedKeyword = /BUILD FAILURE|Finished: FAILURE|ERROR:?/i.test(stderrTail || output);
    const status = exitCode === 0 || (successKeyword && !failedKeyword) ? 'SUCCESS' : 'FAILED';

    // ⑥ 产物扫描 + 留档
    const artifacts: LocalArtifact[] = status === 'SUCCESS' ? scanArtifacts(repoPath, probe, recordId) : [];
    const repoName = path.basename(repoPath);
    const archivePath = archiveBuild(repoPath, {
      record_id: recordId,
      status,
      repo_path: repoPath,
      repo_name: repoName,
      build_target: null,
      timestamp: new Date().toISOString(),
      build_command: buildCommand,
      build_tool: probe.buildTool,
      duration_seconds: durationSeconds,
      artifacts: artifacts.map((a) => ({ name: a.name, path: a.uri, type: 'local', size_bytes: a.size_bytes })),
      output_tail: (stdoutTail + stderrTail).slice(-TAIL_BYTES),
    });

    const data = {
      status,
      repo_path: repoPath,
      repo_type: probe.repoType,
      language: probe.language,
      build_command: buildCommand,
      build_guidance: guidance,
      exit_code: exitCode,
      stdout_tail: stdoutTail,
      stderr_tail: stderrTail,
      duration_seconds: durationSeconds,
      artifacts,
      recommended_steps: status === 'SUCCESS' ? recommendedSteps(probe, buildCommand) : [],
      archived: { record_id: recordId, path: path.relative(repoPath, archivePath) },
    };

    if (status === 'SUCCESS') {
      return makeSuccessResult(data, `本地构建成功（${durationSeconds}s）: ${artifacts.length} 个产物`);
    }
    // 失败：附加结构化错误，模型自决修复策略（FE-01-本地代码仓构建流程设计-20260919.md §4 模型自决）
    return makeSuccessResult(
      {
        ...data,
        error: classifyError(stderrTail, output),
      },
      `本地构建失败（exit=${exitCode}）: ${classifyError(stderrTail, output).error_type}`,
    );
  } catch (e) {
    return mapToolError(e);
  }
}

/** 从指导表取参考命令（无 hint 时） */
function guidanceCommand(probe: ProbeResult): string | null {
  if (!probe.repoType) return null;
  switch (probe.repoType) {
    case 'maven':
      return 'mvn package -DskipTests';
    case 'gradle':
      return 'gradle build -x test';
    case 'npm':
      return 'npm run build';
    case 'go':
      return 'go build ./...';
    case 'python':
      return 'pip install -r requirements.txt && python -m build';
    case 'php':
      return 'composer install --no-dev';
    case 'cmake':
      return 'cmake -S . -B build && cmake --build build';
    case 'msbuild':
      return 'msbuild /p:Configuration=Release';
    case 'docker':
      return 'docker build -t localbuild:latest .';
    default:
      return null;
  }
}
