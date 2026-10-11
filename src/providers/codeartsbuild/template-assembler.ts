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
  // 未匹配 → E_PARAM，列出可用模板（2026-10-10 追加：引导 stepsPlan 用 template_id 而非裸 module_id）
  throw new ToolException(
    'E_PARAM',
    `step="${stepRef}" 未匹配模板`,
    `stepsPlan[].step 应使用 template_id（可用: ${[...TEMPLATE_BY_ID.keys()].join(', ')}）；module_id 仅用于 steps 数组的全限定名（可用: ${[...TEMPLATE_BY_MODULE.keys()].join(', ')}）。若提供的是全限定 module_id（如 devcloud2018.codeci_action_20043.action），stepsPlan 请改用对应 template_id 重试`,
  );
}

/**
 * selectTemplates：language → template_id 数组
 * @throws E_PARAM language 未匹配时
 */
export function selectTemplates(language: string): string[] {
  const refs = LANGUAGE_COMBINATIONS[language];
  if (!refs) {
    throw new ToolException(
      'E_PARAM',
      `language="${language}" 未匹配组合`,
      `可用 language: ${Object.keys(LANGUAGE_COMBINATIONS).join(', ')}`,
    );
  }
  return refs;
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
