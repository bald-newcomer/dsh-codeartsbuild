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
 * 语言 → 推荐步骤组合（对齐 FE-04-Step模板库拆解-20260918.md §1）
 * key 为 language 值，value 为 template_id 数组（顺序即步骤顺序）
 */
const LANGUAGE_COMBINATIONS: Record<string, string[]> = {
  'Java/Maven（jar）': ['maven-build', 'upload-release'],
  'Java/Maven（容器）': ['maven-build', 'build-image-swr'],
  'Java/Gradle': ['gradle-build', 'upload-release'],
  'Java/Android': ['android-build', 'upload-release'],
  'JavaScript/npm': ['npm-build', 'upload-release'],
  'JavaScript/npm（容器）': ['npm-build', 'build-image-swr'],
  'Python/PyInstaller': ['pyinstaller-build', 'upload-release'],
  'Python/其他（setuptools 等）': ['shell-command', 'upload-release'],
  Go: ['go-build', 'upload-release'],
  PHP: ['php-build', 'upload-release'],
  'C/C++/CMake': ['cmake-build', 'upload-release'],
  'C#/MSBuild': ['shell-command', 'upload-release'],
  'Scala/sbt': ['shell-command', 'upload-release'],
  '通用/自定义': ['shell-command'],
  纯镜像: ['build-image-swr'],
  '产物传 OBS': ['upload-obs'],
  '从 OBS 拉取': ['download-obs'],
};

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

/** language 匹配方式（FE-16 §2.4 模糊匹配） */
export type LanguageMatchKind = 'exact' | 'prefix' | 'contains' | 'none';

/** language 匹配结果 */
export interface LanguageMatchResult {
  refs: string[];
  matchedBy: LanguageMatchKind;
  matchedLanguage: string; // 实际命中的 LANGUAGE_COMBINATIONS 键（exact 时 = 入参；模糊时 = 命中的键）
}

/**
 * 模糊推荐最相近的 language（FE-16 §2.4，2026-11-03 会话 e3c9f738）
 * 会话证据：模型传 `Python/uv`（不在枚举）→ 直接 E_PARAM 拒绝；模型只能传空 language 手拼 steps
 *
 * 匹配策略（按优先级）：
 * 1. 完全匹配：`Python/uv` === 枚举键
 * 2. 前缀匹配：`Python/uv` 前缀 `Python/` → 命中 `Python/其他（setuptools 等）`（同前缀下第一个）
 * 3. 包含匹配：入参包含枚举键（`uv Python` 包含 `Python`）→ 命中
 * 4. 无匹配：返回 null（调用方抛 E_PARAM 让用户选）
 */
function suggestClosestLanguage(language: string): { key: string; matchedBy: LanguageMatchKind } | null {
  const keys = Object.keys(LANGUAGE_COMBINATIONS);
  // ① 完全匹配
  if (LANGUAGE_COMBINATIONS[language]) return { key: language, matchedBy: 'exact' };
  // ② 前缀匹配：入参以 `X/` 开头，找同前缀的枚举键（如 `Python/uv` → `Python/其他（setuptools 等）`）
  // 同前缀下优先选"通用"组合（含"其他/通用/custom"等词），避免误选特定打包工具（如 PyInstaller）
  const slashIdx = language.indexOf('/');
  if (slashIdx > 0) {
    const prefix = language.slice(0, slashIdx + 1); // 如 `Python/`
    const samePrefix = keys.filter((k) => k.startsWith(prefix));
    if (samePrefix.length > 0) {
      // 优先选含"其他/通用/custom/自定义"的键（通用 shell-command 组合）
      const generic = samePrefix.find((k) => /其他|通用|custom|自定义/i.test(k));
      const match = generic ?? samePrefix[0];
      return { key: match, matchedBy: 'prefix' };
    }
  }
  // ③ 包含匹配：入参包含某枚举键（如 `uv Python` 包含 `Python`）
  const lower = language.toLowerCase();
  for (const k of keys) {
    if (lower.includes(k.toLowerCase())) return { key: k, matchedBy: 'contains' };
  }
  // ④ 枚举键包含入参（如入参 `Python` 命中 `Python/PyInstaller`）——取第一个包含的
  for (const k of keys) {
    if (k.toLowerCase().includes(lower)) return { key: k, matchedBy: 'contains' };
  }
  return null;
}

/**
 * selectTemplates：language → template_id 数组（FE-16 §2.4 模糊匹配）
 * 匹配优先级：完全 > 前缀 > 包含 > 无匹配（抛 E_PARAM + 推荐最相近）
 * @throws E_PARAM language 完全无匹配时
 */
export function selectTemplates(language: string): string[] {
  const match = suggestClosestLanguage(language);
  if (!match) {
    throw new ToolException(
      'E_PARAM',
      `language="${language}" 未匹配组合，且无相近语言`,
      `可用 language: ${Object.keys(LANGUAGE_COMBINATIONS).join(', ')}——请从列表选择，或改用 stepsPlan 手动指定步骤`,
    );
  }
  return LANGUAGE_COMBINATIONS[match.key];
}

/** selectTemplates 模糊匹配结果（含匹配方式，供调用方日志/审计） */
export function selectTemplatesWithMatch(language: string): LanguageMatchResult {
  const match = suggestClosestLanguage(language);
  if (!match) {
    throw new ToolException(
      'E_PARAM',
      `language="${language}" 未匹配组合，且无相近语言`,
      `可用 language: ${Object.keys(LANGUAGE_COMBINATIONS).join(', ')}——请从列表选择，或改用 stepsPlan 手动指定步骤`,
    );
  }
  return {
    refs: LANGUAGE_COMBINATIONS[match.key],
    matchedBy: match.matchedBy,
    matchedLanguage: match.key,
  };
}

/**
 * loadTemplate：按 template_id 加载模板
 */
export function loadTemplate(templateId: string): StepTemplate {
  const tpl = TEMPLATE_BY_ID.get(templateId);
  if (!tpl) {
    throw new ToolException('E_PARAM', `template_id="${templateId}" 未找到`, `可用: ${[...TEMPLATE_BY_ID.keys()].join(', ')}`);
  }
  return tpl;
}

/**
 * validateSteps：module_id 白名单校验 + image 可用值校验（FE-11 延伸，2026-10-10）
 * @throws E_PARAM module_id 不在白名单 / image 不在该模板 image_select 可用枚举内
 */
export function validateSteps(steps: Step[]): void {
  for (const [i, step] of steps.entries()) {
    if (!step.module_id || !WHITELIST_MODULE_IDS.has(step.module_id)) {
      throw new ToolException(
        'E_PARAM',
        `steps[${i}].module_id="${step.module_id}" 不在白名单`,
        'module_id 必须取自 recommended_steps / list_templates / 实测白名单（见 step-index.json）',
      );
    }
    if (!step.name || !step.name.trim()) {
      throw new ToolException('E_PARAM', `steps[${i}].name 为空`, '每步必须含 name');
    }
    validateStepImage(i, step);
    validateStepProperties(i, step);
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
 * assembleSteps：stepsPlan/language → steps[]（数组顺序即构建步骤顺序）
 * @param input.stepsPlan 意图级步骤计划（推荐）
 * @param input.language 速选默认组合
 * @returns steps[]（含 module_id/name/properties/enable）
 */
export function assembleSteps(input: {
  stepsPlan?: StepsPlanItem[];
  language?: string;
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
  // ② language：速选默认组合（顺序+参数由模板定义）
  if (input.language) {
    const refs = selectTemplates(input.language);
    return refs.map((ref) => {
      const tpl = loadTemplate(ref);
      return {
        module_id: tpl.module_id,
        name: tpl.name,
        properties: stripSelectFields({ ...tpl.properties }),
        enable: true,
      };
    });
  }
  // 三者皆无
  throw new ToolException(
    'E_PARAM',
    'steps/stepsPlan/language 三者皆无',
    '请传 steps（原样透传）/ stepsPlan（意图级步骤计划，推荐）/ language（速选默认组合）之一',
  );
}

/**
 * assembleConfig：注入 config-template.json 占位，产出 CreateNewJob 请求体
 * 对齐 FE-03-工具详细设计-20260918.md §3.4 伪代码
 */
export function assembleConfig(input: CreateJobInput): CreateNewJobRequest {
  // steps 组装（显式 steps 最高优先；否则 stepsPlan/language）
  // 显式 steps 也需剥离 _select（FE-11：防模型从模板复制时带入 _select 字段进请求体）
  const steps: Step[] = input.steps
    ? input.steps.map((s) => ({ ...s, properties: stripSelectFields(s.properties as Record<string, unknown>) }))
    : assembleSteps({ stepsPlan: input.stepsPlan, language: input.language });
  validateSteps(steps);

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
 * 获取可用 language 组合清单
 */
export function listAvailableLanguages(): string[] {
  return Object.keys(LANGUAGE_COMBINATIONS);
}

/**
 * 获取白名单 module_id 清单
 */
export function listWhitelistModuleIds(): string[] {
  return [...WHITELIST_MODULE_IDS];
}
