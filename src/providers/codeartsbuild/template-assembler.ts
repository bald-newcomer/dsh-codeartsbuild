/**
 * create_job 模板化组装器
 * 对齐 FE-03-工具详细设计-20260918.md §3.4 + FE-04-Step模板库拆解-20260918.md §7.4
 *
 * 职责：
 * 1. 加载 bundle 内 step-templates.json（14 模板）/ config-template.json（请求骨架）/ step-index.json（白名单）
 * 2. resolveStep：step（template_id 或 module_id）→ 模板
 * 3. assembleSteps：stepsPlan/language → steps[]（数组顺序即构建步骤顺序）
 * 4. assembleConfig：注入 config-template.json 占位
 * 5. validateSteps：module_id 白名单校验
 *
 * 组装优先级：steps > stepsPlan > language
 */
import { ToolException } from '../../core/types.js';
import type {
  Step,
  CreateJobInput,
  CreateNewJobRequest,
  StepsPlanItem,
} from '../../core/types.js';

// bundle 内打包的 JSON 资产（resolveJsonModule: true）
import stepTemplates from './assets/step-templates.json' with { type: 'json' };
import configTemplate from './assets/config-template.json' with { type: 'json' };
import stepIndex from './assets/step-index.json' with { type: 'json' };

/** Step 模板（来自 step-templates.json） */
export interface StepTemplate {
  template_id: string;
  name: string;
  module_id: string;
  properties: Record<string, unknown>;
  /** 核心构建工具（FE-17 §2.1，2026-11-05）：标识模板镜像内置的语言/构建运行时；选用标准是核心工具而非 shell；空表示无构建运行时（产物上传/下载等） */
  core_tool?: 'maven' | 'npm' | 'go' | 'python' | 'php' | 'cmake' | 'gradle' | 'android-gradle' | 'docker' | 'shell-only' | 'none';
}

/** Step 索引条目（来自 step-index.json，用于白名单） */
export interface StepIndexEntry {
  module_id: string;
  uuid: string;
  name: string;
  description?: string;
  tags?: string[];
  default_properties?: Record<string, unknown>;
}

/** 加载的模板数据 */
const TEMPLATES: StepTemplate[] = stepTemplates as StepTemplate[];
const CONFIG_TEMPLATE = configTemplate as Record<string, unknown>;
const STEP_INDEX: StepIndexEntry[] = stepIndex as StepIndexEntry[];

/** 白名单 module_id 集合（来自 step-index.json，20 条已过滤不维护插件） */
const WHITELIST_MODULE_IDS: Set<string> = new Set(STEP_INDEX.map((e) => e.module_id));

/** template_id → 模板 映射 */
const TEMPLATE_BY_ID: Map<string, StepTemplate> = new Map(TEMPLATES.map((t) => [t.template_id, t]));

/** module_id → 模板 映射 */
const TEMPLATE_BY_MODULE: Map<string, StepTemplate> = new Map(TEMPLATES.map((t) => [t.module_id, t]));

/**
 * module_id → 允许的 properties 键名集合（FE-16 §2.1，2026-11-03 会话 e3c9f738）
 * 从 step-templates.json 的每个模板 properties 中提取键名（剔除 _select 后缀字段）
 * 用于 validateStepProperties：steps[].properties 键名必须在白名单内，否则 E_PARAM
 * 会话证据：模型传 shellContent（不在 shell-command 模板 properties 中）被服务端静默吞掉变 echo 'hello'
 */
const TEMPLATE_ALLOWED_PROPERTY_KEYS: Map<string, Set<string>> = new Map(
  TEMPLATES.map((t) => {
    const keys = new Set<string>();
    for (const k of Object.keys(t.properties ?? {})) {
      if (!k.endsWith('_select')) keys.add(k);
    }
    return [t.module_id, keys];
  }),
);

/**
 * 步骤名 → 最接近的 template_id 模糊推荐（FE-15 §3，2026-10-23 会话 63534983）
 * 会话证据：模型传 `code-checkout`/`pip-install` 撞"未匹配模板"空转 4 轮——
 * 模型不知道可用 template_id 清单。此处按关键词启发式给出推荐，让模型一次修正到位。
 *
 * 精确匹配（完全一致的步骤名 → 确定推荐）：
 * - code-checkout / checkout / clone：建仓+推码已由 repo_prepare/repo_push 完成，**无需 checkout 步骤**
 * - pip-install / pip / python install / requirements：Python 依赖安装 → shell-command（自定义命令）
 * - npm-install / yarn：依赖安装 → npm-build
 * 关键词匹配（从 template_id 清单中取最接近者）：
 * - install/deps → shell-command（自定义安装命令）
 * - build/compile → 按语言（python→pyinstaller-build、npm→npm-build 等）
 * - test/unit → unit-report
 * - image/docker → build-image-swr
 * - upload/obs → upload-release / upload-obs
 */
const STEP_NAME_SUGGESTIONS: Array<{ pattern: RegExp; suggestions: string[]; note?: string }> = [
  { pattern: /^(code-)?checkout|clone/i, suggestions: [], note: '建仓+推码已由 repo_prepare/repo_push 完成，构建任务无需 checkout 步骤——请省略该步骤' },
  { pattern: /^pip-?install|pip|requirements|python.*install/i, suggestions: ['shell-command', 'pyinstaller-build'], note: 'Python 依赖/安装用 shell-command 写自定义命令（如 pip install -r requirements.txt）' },
  { pattern: /^npm-?install|yarn|pnpm/i, suggestions: ['npm-build'] },
  { pattern: /install|deps|dependencies/i, suggestions: ['shell-command'] },
  { pattern: /docker|image|镜像/i, suggestions: ['build-image-swr'] },
  { pattern: /test|unit/i, suggestions: ['unit-report'] },
  { pattern: /upload|release|obs/i, suggestions: ['upload-release', 'upload-obs'] },
];

/** 步骤名模糊推荐（未匹配 template_id 时，给出最接近的 template_id 建议） */
export function suggestTemplateRefs(stepRef: string): { suggestions: string[]; note?: string } | null {
  for (const s of STEP_NAME_SUGGESTIONS) {
    if (s.pattern.test(stepRef)) {
      return { suggestions: s.suggestions, note: s.note };
    }
  }
  return null;
}

/**
 * resolveStep：step（template_id 或 module_id）→ 模板
 * @throws E_PARAM 未匹配时
 */
export function resolveStep(stepRef: string): StepTemplate {
  // 优先按 template_id 匹配
  const byId = TEMPLATE_BY_ID.get(stepRef);
  if (byId) return byId;
  // 其次按 module_id 匹配
  const byModule = TEMPLATE_BY_MODULE.get(stepRef);
  if (byModule) return byModule;
  // 未匹配 → E_PARAM，列出可用模板 + 模糊推荐（2026-10-10 引导 stepsPlan 用 template_id；FE-15 追加推荐）
  const suggestion = suggestTemplateRefs(stepRef);
  const suggestText = suggestion
    ? suggestion.suggestions.length > 0
      ? `\n推荐 template_id: ${suggestion.suggestions.join(', ')}${suggestion.note ? `（${suggestion.note}）` : ''}`
      : `\n${suggestion.note ?? ''}`
    : '';
  throw new ToolException(
    'E_PARAM',
    `step="${stepRef}" 未匹配模板${suggestText}`,
    `stepsPlan[].step 应使用 template_id（可用: ${[...TEMPLATE_BY_ID.keys()].join(', ')}）；module_id 仅用于 steps 数组的全限定名（可用: ${[...TEMPLATE_BY_MODULE.keys()].join(', ')}）。若提供的是全限定 module_id（如 devcloud2018.codeci_action_20043.action），stepsPlan 请改用对应 template_id 重试`,
  );
}

/**
 * validateSteps：module_id 白名单校验 + image 可用值校验 + 字段契约 + 模板选用规约（FE-11/16/17）
 * @throws E_PARAM module_id 不在白名单 / image 不在该模板 image_select 可用枚举内 / properties 键名非法 / 模板选用 mismatch
 */
export function validateSteps(steps: Step[], projectRepoType?: string): void {
  for (const [i, step] of steps.entries()) {
    if (!step.module_id || !WHITELIST_MODULE_IDS.has(step.module_id)) {
      // FE-17 §2.3：错误信息增强——列完整白名单值（前 5 + 总数 + template_id 对照）
      const allModuleIds = [...WHITELIST_MODULE_IDS];
      const sample = allModuleIds.slice(0, 5).map((mid) => {
        const tpl = TEMPLATE_BY_MODULE.get(mid);
        return `${mid} (${tpl?.template_id ?? '?'})`;
      }).join(', ');
      throw new ToolException(
        'E_PARAM',
        `steps[${i}].module_id="${step.module_id}" 不在白名单（共 ${allModuleIds.length} 个）`,
        `module_id 必须取自 step-index.json 白名单（格式 devcloud2018.codeci_action_<N>.action，非裸包名 com.hw.codearts...）。可用: ${sample}, ...——stepsPlan 用 template_id（如 maven-build），steps 数组用全限定 module_id（如 devcloud2018.codeci_action_20043.action）`,
      );
    }
    if (!step.name || !step.name.trim()) {
      throw new ToolException('E_PARAM', `steps[${i}].name 为空`, '每步必须含 name');
    }
    validateStepImage(i, step);
    validateStepProperties(i, step);
  }
  // FE-17 §2.1：模板选用 mismatch 检测（项目语言已知时，shell-command 不该用于 python/maven 等语言构建）
  if (projectRepoType) {
    validateTemplateMismatch(steps, projectRepoType);
  }
}

/**
 * repo_type（subagent build_info）→ core_tool 映射（FE-17 §2.1，2026-11-05 会话 652fb005）
 * 用于模板选用 mismatch 检测：项目语言已知时，shell-command（core_tool=shell-only）不该用于跑 pip/pytest/mvn 等
 */
const REPO_TYPE_TO_CORE_TOOL: Record<string, string> = {
  python: 'python',
  npm: 'npm',
  maven: 'maven',
  gradle: 'gradle',
  go: 'go',
  rust: 'cargo', // rust 无对应模板，shell-command 是唯一选择（mismatch 不拦）
  c: 'cmake',
  cpp: 'cmake',
  other: 'shell-only', // other 不拦（无明确语言）
};

/**
 * 模板选用 mismatch 检测（FE-17 §2.1，2026-11-05 会话 652fb005）
 * 会话证据：模型用 shell-command（镜像 shell4.2.46 不含 Python）跑 pip install + pytest → pip: command not found
 * 用户决策（2026-11-05）：选用标准是核心构建工具（python→pyinstaller-build），shell-command 仅用于无语言运行时的纯 shell 任务
 *
 * 检测规则：
 * - 项目 repo_type 是 python/npm/maven/go 等（有对应 core_tool 模板）+ steps 含 shell-command → E_PARAM 引导
 * - shell-command 的 image_select 只有 shell4.2.46-git1.8.3-zip6.00（不含语言运行时），不该跑 pip/npm/mvn
 * - 不拦的场景：repo_type=other/rust（无对应模板）；stepsPlan 用 upload-release 等非 shell-command 模板
 * @throws E_PARAM 项目语言有对应 core_tool 模板但用了 shell-command
 */
function validateTemplateMismatch(steps: Step[], projectRepoType: string): void {
  const expectedCoreTool = REPO_TYPE_TO_CORE_TOOL[projectRepoType.toLowerCase()];
  if (!expectedCoreTool || expectedCoreTool === 'shell-only') return; // 无对应模板或 other → 不拦
  // 找 steps 中的 shell-command 步骤
  for (const [i, step] of steps.entries()) {
    const tpl = TEMPLATE_BY_MODULE.get(step.module_id);
    if (!tpl || tpl.core_tool !== 'shell-only') continue; // 非 shell-command 模板 → 跳过
    // 找对应 core_tool 的推荐模板（如 python → pyinstaller-build）
    const recommended = TEMPLATES.find((t) => t.core_tool === expectedCoreTool);
    if (!recommended) continue;
    throw new ToolException(
      'E_PARAM',
      `steps[${i}] 用 shell-command（core_tool=shell-only，镜像 shell4.2.46 不含 ${expectedCoreTool} 运行时）跑 ${projectRepoType} 构建——模板选用 mismatch`,
      `项目语言 ${projectRepoType} 应选 core_tool=${expectedCoreTool} 的模板（如 ${recommended.template_id}，镜像 ${recommended.properties.image}，覆盖 command 为实际构建命令即可）；shell-command 仅用于无语言运行时的纯 shell 任务（脚本调度/文件操作）。每个模板的默认 command 都可被 properties.command 覆盖（如 ${recommended.template_id} 默认 ${JSON.stringify(recommended.properties.command)}，覆盖为 'pip install -r requirements.txt && pytest' 即变 Python 测试任务）`,
    );
  }
}

/**
 * 前缀匹配推荐可用镜像（FE-12 P5）：臆造 `nodejs20.18.0` → 推荐 `nodejs20`
 * 边界精确：`nodejs20.18.0` 前缀匹配 `nodejs20`；但 `nodejs2` 不应匹配 `nodejs20`（用"值 或 值+."前缀判定）
 * @returns 推荐镜像（字面量，勿补全）；无匹配返回 null
 */
function suggestClosestImage(image: string, allowed: string[]): string | null {
  // 精确前缀：镜像名 + "."（如 nodejs20.）——值本身或其后续补丁号
  for (const cand of allowed) {
    if (image === cand || image.startsWith(`${cand}.`)) return cand;
  }
  return null;
}

/**
 * 镜像名可用值校验（FE-11 延伸：c6ca1e11 会话模型臆造 nodejs18.0.0/nodejs14.17.0 等镜像致 6 轮空转）
 * - 模板 properties 有 `image_select`（FE-11 已迁移）时：properties.image 必须在枚举内（或等于模板默认值）
 * - 模板无 `image_select`：不允许覆盖 image（无可用值参照，覆盖即臆造风险）
 * - 未传 image（用默认值）→ 放行
 * - 2026-10-11（FE-12 P5）：错误 details 追加前缀匹配推荐值（臆造 nodejs20.18.0 → 推荐 nodejs20，字面量勿补全）
 */
function validateStepImage(index: number, step: Step): void {
  const tpl = TEMPLATE_BY_MODULE.get(step.module_id);
  if (!tpl) return; // module_id 已在白名单校验，此处模板未命中即跳过
  const props = step.properties ?? {};
  if (props.image === undefined || props.image === null || props.image === '') return; // 未覆盖 → 用默认值
  const image = String(props.image);
  const tplDefault = tpl.properties.image === undefined ? undefined : String(tpl.properties.image);
  // 等于模板默认值 → 放行（模板自带默认 image 恒合法，避免 upload-release 等无 image_select 模板误拦）
  if (tplDefault && image === tplDefault) return;
  const imageSelect = tpl.properties.image_select;
  if (Array.isArray(imageSelect) && imageSelect.length > 0) {
    const allowed = imageSelect.map(String);
    if (!allowed.includes(image)) {
      const suggestion = suggestClosestImage(image, allowed);
      const suggestText = suggestion
        ? `——若需 ${suggestion} 系版本，请用字面量 \`${suggestion}\`（勿补全为 ${suggestion}.x）`
        : '';
      throw new ToolException(
        'E_PARAM',
        `steps[${index}].properties.image="${image}" 不在可用镜像列表`,
        `模板 ${tpl.template_id}（${tpl.name}）可用镜像: ${allowed.join(', ')}${suggestText}——image_select 值为服务端字面量，照抄勿补全/加补丁号（实测 nodejs20.18.0 等不存在致构建调度失败）；不覆盖 image 时用默认值 ${String(tplDefault ?? '')}`,
      );
    }
  } else {
    // 无 image_select 的模板不允许覆盖 image（默认值除外）
    throw new ToolException(
      'E_PARAM',
      `steps[${index}].properties.image="${image}" 覆盖不被支持`,
      `模板 ${tpl.template_id}（${tpl.name}）未声明可用镜像枚举（image_select）——覆盖 image 属臆造风险；请省略 image 用模板默认值（${String(tplDefault ?? '无')}），或改用有 image_select 的模板`,
    );
  }
}

/**
 * 模糊推荐最接近的 properties 键名（FE-16 §2.1，2026-11-03 会话 e3c9f738）
 * 会话证据：模型传 `shellContent`（shell-command 模板无此键）→ 推荐正确键名 `command`
 *
 * 匹配策略（按优先级）：
 * 1. 大小写不敏感完全匹配（`Command` → `command`）
 * 2. 包含关系（`shellContent` 包含 `shell`，但 shell-command 无 `shell` 键 → 跳过；`command` 在 `shellContent` 中 → 推荐 `command`）
 * 3. 编辑距离 ≤ 2（`comand` → `command`）
 * @returns 推荐键名（字面量，勿补全）；无匹配返回 null
 */
function suggestClosestPropertyKey(key: string, allowed: string[]): string | null {
  // ① 大小写不敏感完全匹配
  const lower = key.toLowerCase();
  for (const cand of allowed) {
    if (cand.toLowerCase() === lower) return cand;
  }
  // ② 包含关系：候选键名是输入的子串（`command` 在 `shellContent` 中 → 推荐 `command`）
  for (const cand of allowed) {
    if (key.toLowerCase().includes(cand.toLowerCase())) return cand;
  }
  // ③ 编辑距离 ≤ 2（容错拼写错误，如 `comand` → `command`）
  for (const cand of allowed) {
    if (levenshtein(key.toLowerCase(), cand.toLowerCase()) <= 2) return cand;
  }
  return null;
}

/** Levenshtein 编辑距离（小写比较，容错拼写） */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * properties 键名校验（FE-16 §2.1，2026-11-03 会话 e3c9f738）
 * 会话证据：模型在 steps[].properties 中传 `shellContent`（shell-command 模板无此键），
 *           服务端静默吞掉 → 回读发现命令是默认 `echo 'hello'`——字段名应从模板定义强约束
 *
 * - steps[].properties 的每个键必须在模板 properties 键名白名单内（剔除 _select 后缀字段）
 * - 不在白名单 → E_PARAM + 模糊推荐最接近的键名（`shellContent` → 推荐 `command`）
 * - 软提示：区分 stepsPlan 语法层（`stepsPlan[].properties.shellContent`）与 steps 数组层（`steps[].properties.command`）
 * @throws E_PARAM properties 键名不在模板白名单
 */
function validateStepProperties(index: number, step: Step): void {
  const tpl = TEMPLATE_BY_MODULE.get(step.module_id);
  if (!tpl) return; // module_id 已在白名单校验，此处模板未命中即跳过
  const allowed = TEMPLATE_ALLOWED_PROPERTY_KEYS.get(step.module_id);
  if (!allowed || allowed.size === 0) return; // 模板无 properties 定义 → 跳过
  const props = step.properties ?? {};
  for (const key of Object.keys(props)) {
    if (allowed.has(key)) continue; // 在白名单 → 放行
    const suggestion = suggestClosestPropertyKey(key, [...allowed]);
    const suggestText = suggestion
      ? `——最接近的字段名是 \`${suggestion}\`（请改用 \`${suggestion}\`）`
      : `——模板可用字段: ${[...allowed].join(', ')}`;
    throw new ToolException(
      'E_PARAM',
      `steps[${index}].properties.${key} 不在模板 ${tpl.template_id}（${tpl.name}）的可用字段中`,
      `字段 \`${key}\` 不在模板 ${tpl.template_id} 可用 properties 字段中。模板可用字段: ${[...allowed].join(', ')}${suggestText}。` +
        `注意：stepsPlan[].properties 用 shellContent（意图级语法），但 steps[].properties 用 command（数组层语法，最终请求体）——两层语法不同，勿混用。` +
        `字段名必须取自 step-templates.json 模板定义（FE-16 §2.1 机制化，会话 e3c9f738：模型传 shellContent 被服务端静默吞掉变 echo 'hello'）`,
    );
  }
}

/** 剥离 properties 中的 `_select` 后缀字段（FE-11：可用值枚举仅供模型参考，不进请求体） */
function stripSelectFields(properties: Record<string, unknown> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(properties ?? {})) {
    if (!k.endsWith('_select')) result[k] = v;
  }
  return result;
}

/**
 * assembleSteps：stepsPlan → steps[]（数组顺序即构建步骤顺序）
 * @param input.stepsPlan 意图级步骤计划（推荐）
 * @returns steps[]（含 module_id/name/properties/enable）
 */
export function assembleSteps(input: {
  stepsPlan?: StepsPlanItem[];
}): Step[] {
  // ① stepsPlan：意图级步骤计划（顺序 + 每步参数，properties 合并默认值）
  if (input.stepsPlan && input.stepsPlan.length > 0) {
    return input.stepsPlan.map((plan) => {
      const tpl = resolveStep(plan.step);
      const properties = stripSelectFields({
        ...tpl.properties,
        ...(plan.properties ?? {}),
      });
      const step: Step = { module_id: tpl.module_id, name: tpl.name, properties, enable: true };
      // image 可用值校验（FE-11 延伸：stepsPlan 臆造镜像版本致调度失败——组装期即拦截）
      validateStepImage(0, step);
      return step;
    });
  }
  // stepsPlan 缺省
  throw new ToolException(
    'E_PARAM',
    'steps/stepsPlan 皆无',
    '请传 steps（原样透传）/ stepsPlan（意图级步骤计划，推荐）之一',
  );
}

/**
 * assembleConfig：注入 config-template.json 占位，产出 CreateNewJob 请求体
 * 对齐 FE-03-工具详细设计-20260918.md §3.4 伪代码
 */
export function assembleConfig(input: CreateJobInput): CreateNewJobRequest {
  // FE-17 §2.1：projectRepoType 透传给 validateSteps 做模板选用 mismatch 检测
  // steps 组装（显式 steps 最高优先；否则 stepsPlan/language）
  // 显式 steps 也需剥离 _select（FE-11：防模型从模板复制时带入 _select 字段进请求体）
  const steps: Step[] = input.steps
    ? input.steps.map((s) => ({ ...s, properties: stripSelectFields(s.properties as Record<string, unknown>) }))
    : assembleSteps({ stepsPlan: input.stepsPlan });
  validateSteps(steps, input.projectRepoType);

  return {
    arch: input.arch,
    project_id: input.projectId,
    job_name: input.jobName,
    steps,
    scms: input.scms,
    parameters: input.parameters ?? [],
    description: input.description,
    flavor: input.flavor,
    host_type: input.hostType ?? 'devcloud',
    build_config_type: input.buildConfigType ?? 'ACTION',
    source_code: input.sourceCode,
    build_if_code_updated: input.buildIfCodeUpdated ?? false,
    auto_update_sub_module: input.autoUpdateSubModule ?? 'false',
    agency_urn: input.agencyUrn,
    group_id: input.groupId,
  };
}

/**
 * 获取可用模板清单（供错误提示/debug）
 */
export function listAvailableTemplates(): StepTemplate[] {
  return [...TEMPLATES];
}

/**
 * 获取白名单 module_id 清单
 */
export function listWhitelistModuleIds(): string[] {
  return [...WHITELIST_MODULE_IDS];
}
