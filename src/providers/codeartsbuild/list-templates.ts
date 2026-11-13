/**
 * codeartsbuild_list_templates 工具 handler
 * 对齐 api-contract.md §2.13
 *
 * 职责（2026-11-06 优化）：
 * - 查询**用户自定义模板**（ListCustomTemplate，GET /v1/template/custom）
 * - 查询**官方模板**（ListOfficialTemplate，GET /v1/template/officialtemplates）——过滤掉过时/小众模板
 * - 输出**组合场景**（combination-scenarios.json，语言→steps 组合，供 stepsPlan 设计参考）
 *
 * source 入参：
 * - 'custom'（缺省）：查 ListCustomTemplate
 * - 'official'：查 ListOfficialTemplate（过滤后）
 * - 'all'：并行查两个接口
 *
 * 输出结构（2026-11-06 精简）：
 * - combination_scenarios：语言→组合表（供 stepsPlan 设计参考）
 * - custom_templates：用户自定义模板（source=custom/all）
 * - official_templates：官方模板（source=official/all，已过滤过时/小众）
 * - summary：各类模板计数
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

// bundle 内打包的 JSON 资产（resolveJsonModule: true）
import combinationScenarios from './assets/combination-scenarios.json' with { type: 'json' };

/** ListCustomTemplate / ListOfficialTemplate 响应（同构） */
interface TemplateListResponse {
  result?: {
    items?: Array<Record<string, unknown>>;
    total_size?: number;
  };
  error?: unknown;
  status?: string;
}

/** 工具入参 */
export interface ListTemplatesHandlerInput {
  name?: string;
  page?: number;
  pageSize?: number;
  filter?: string;
  tags?: string;
  /** 查询来源：'custom'（缺省，用户自定义）/ 'official'（官方）/ 'all'（并行查两个） */
  source?: 'custom' | 'official' | 'all';
}

/** 规范化单个模板（custom/official 同构） */
function normalizeTemplate(item: Record<string, unknown>) {
  const template = (item.template as Record<string, unknown> | undefined) ?? {};
  return {
    uuid: item.uuid ?? null,
    name: item.name ?? null,
    description: item.description ?? null,
    scope: item.scope ?? null,
    type: item.type ?? null,
    public: item.public ?? null,
    favourite: item.favourite ?? null,
    nick_name: item.nick_name ?? null,
    create_time: item.create_time ?? null,
    user_name: item.user_name ?? null,
    steps: template.steps ?? [],
    parameters: item.parameters ?? [],
  };
}

/**
 * 过时/小众/平台特定的官方模板名称（2026-11-09 人工评估剔除）
 * - 过时构建工具：Ant/Grails/Grunt/gulp/Mono/Bazel/sbt/HarmonyOS/GNU-ARM/QuickApp
 * - 重复 module_id：MSBuild for Qt/MSBuild（含 20022 upload-win 与 20018 重复）、servicestage-npm-war（含 20002 Ant）
 * - 平台特定模板：ServiceStage/DevStar/Serverless（需特定平台部署，非通用构建）
 * - 被本地 step 模板覆盖：Yarn（yarn-build 已纳入 step-templates）、Setuptools（setuptools-build 已纳入）
 */
const DEPRECATED_OFFICIAL_TEMPLATE_NAMES = new Set([
  'Ant',
  'QuickApp',
  'Grails',
  'Grunt',
  'gulp',
  'mono-linux',
  'Bazel',
  'sbt',
  'HarmonyOS',
  'GNU-ARM',
  'MSBuild for Qt', // 含 20022（upload-win），20020 已纳入 step-templates，20022 与 20018 重复
  'MSBuild',         // 同上含 20022
  'servicestage-npm-war', // 含 20002（Ant），过时
  'ServiceStage-Maven-镜像构建', // 平台特定（ServiceStage 部署）
  'serverless-npm', // 平台特定（Serverless 部署）
  'DevStar-Maven-容器构建', // 平台特定（DevStar）
  'DevStar-Npm-容器构建', // 平台特定（DevStar）
  'DevStar-Python-容器构建', // 平台特定（DevStar）
  'Yarn', // yarn-build 已纳入 step-templates.json
  'Setuptools', // setuptools-build 已纳入 step-templates.json
]);

/** module_id → template_id 映射（与 step-templates.json 对齐，2026-11-09） */
const MODULE_TO_TEMPLATE_ID: Record<string, string> = {
  'devcloud2018.codeci_action_20043.action': 'maven-build',
  'devcloud2018.codeci_action_20004.action': 'build-image-swr',
  'devcloud2018.codeci_action_20005.action': 'cmake-build',
  'devcloud2018.codeci_action_20008.action': 'gradle-build',
  'devcloud2018.codeci_action_20014.action': 'npm-build',
  'devcloud2018.codeci_action_20015.action': 'pyinstaller-build',
  'devcloud2018.codeci_action_20016.action': 'setuptools-build',
  'devcloud2018.codeci_action_20017.action': 'shell-command',
  'devcloud2018.codeci_action_20018.action': 'upload-release',
  'devcloud2018.codeci_action_20019.action': 'yarn-build',
  'devcloud2018.codeci_action_20020.action': 'msbuild-build',
  'devcloud2018.codeci_action_20026.action': 'go-build',
  'devcloud2018.codeci_action_20032.action': 'android-build',
  'devcloud2018.codeci_action_20037.action': 'php-build',
  'devcloud2018.codeci_action_20057.action': 'upload-obs',
  'devcloud2018.codeci_action_20063.action': 'download-obs',
  'devcloud2018.codeci_action_20071.action': 'unit-report',
};

/**
 * 从官方模板 steps 抽取 step 模板（2026-11-09）
 * 结构对齐 step-templates.json：template_id/name/module_id/properties
 * - 按 module_id 去重（同一 step 在多个官方模板出现只保留一次）
 * - template_id 从 MODULE_TO_TEMPLATE_ID 映射；未映射的用 module_id 尾号派生
 * - properties 直接取自官方 step 的 properties（含 image/command/preCondition 等，无 image_select）
 * @param officialTemplates 过滤后的官方模板
 */
function extractOfficialStepTemplates(officialTemplates: ReturnType<typeof normalizeTemplate>[]) {
  const stepMap = new Map<string, { template_id: string; name: string; module_id: string; properties: Record<string, unknown> }>();
  for (const tpl of officialTemplates) {
    const steps = tpl.steps as Array<Record<string, unknown>>;
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      const moduleId = step.module_id as string | undefined;
      if (!moduleId || stepMap.has(moduleId)) continue;
      const numMatch = moduleId.match(/200(\d+)/);
      const templateId = MODULE_TO_TEMPLATE_ID[moduleId] ?? `step-${numMatch ? numMatch[1] : moduleId}`;
      stepMap.set(moduleId, {
        template_id: templateId,
        name: (step.name as string) ?? moduleId,
        module_id: moduleId,
        properties: (step.properties as Record<string, unknown>) ?? {},
      });
    }
  }
  return [...stepMap.values()];
}

/** 查询单个接口（custom 或 official） */
async function queryTemplates(
  ctx: CloudToolContext,
  source: 'custom' | 'official',
  input: ListTemplatesHandlerInput,
): Promise<{ templates: ReturnType<typeof normalizeTemplate>[]; total: number }> {
  const path = source === 'custom' ? '/v1/template/custom' : '/v1/template/officialtemplates';
  const resp = await ctx.client.call<TemplateListResponse>(
    {
      method: 'GET',
      path,
      query: {
        name: input.name,
        page: input.page,
        page_size: input.pageSize,
        filter: input.filter,
        tags: input.tags,
      },
    },
    { idempotent: true },
  );
  const rawItems = resp.result?.items ?? [];
  let templates = rawItems.map(normalizeTemplate);
  // official 模板过滤掉过时/小众模板
  if (source === 'official') {
    templates = templates.filter((t) => !DEPRECATED_OFFICIAL_TEMPLATE_NAMES.has(t.name as string));
  }
  return { templates, total: resp.result?.total_size ?? templates.length };
}

/**
 * list_templates 工具 handler（查用户自定义模板 + 官方模板 + 组合场景）
 */
export async function listTemplatesHandler(
  ctx: CloudToolContext,
  input: ListTemplatesHandlerInput,
): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (input.name !== undefined && (input.name.length < 1 || input.name.length > 115)) {
      throw new ToolException('E_PARAM', `name 长度非法（1~115），实际: ${input.name.length}`);
    }
    if (input.page !== undefined && input.page < 1) {
      throw new ToolException('E_PARAM', `page 非法（≥1），实际: ${input.page}`);
    }
    if (input.pageSize !== undefined && (input.pageSize < 1 || input.pageSize > 100)) {
      throw new ToolException('E_PARAM', `pageSize 越界（1~100），实际: ${input.pageSize}`);
    }

    const source = input.source ?? 'custom';

    // ② 组合场景（combination-scenarios.json，供 stepsPlan 设计参考）
    const combinations = combinationScenarios as Array<Record<string, unknown>>;

    // ③ 查询远端模板（custom/official/all）
    let customTemplates: ReturnType<typeof normalizeTemplate>[] = [];
    let officialTemplates: ReturnType<typeof normalizeTemplate>[] = [];
    let customTotal = 0;
    let officialTotal = 0;

    if (source === 'custom' || source === 'all') {
      const r = await queryTemplates(ctx, 'custom', input);
      customTemplates = r.templates;
      customTotal = r.total;
    }
    if (source === 'official' || source === 'all') {
      const r = await queryTemplates(ctx, 'official', input);
      officialTemplates = r.templates;
      officialTotal = r.total;
    }

    // ④ 输出
    const result: Record<string, unknown> = {
      combination_scenarios: combinations,
      summary: {
        combination_count: combinations.length,
        custom_count: customTotal,
        official_count: officialTemplates.length,
      },
    };
    if (source === 'custom' || source === 'all') {
      result.custom_templates = customTemplates;
    }
    if (source === 'official' || source === 'all') {
      result.official_templates = officialTemplates;
      // 从官方模板 steps 抽取 step 模板（结构对齐 step-templates.json）
      result.official_step_templates = extractOfficialStepTemplates(officialTemplates);
      (result.summary as Record<string, unknown>).official_step_count = (result.official_step_templates as unknown[]).length;
    }

    const parts: string[] = [`${combinations.length} 个组合场景`];
    if (source === 'custom' || source === 'all') parts.push(`${customTotal} 个自定义模板`);
    if (source === 'official' || source === 'all') parts.push(`${officialTemplates.length} 个官方模板（已过滤过时模板）`);

    return makeSuccessResult(result, `list_templates: ${parts.join('，')}`);
  } catch (e) {
    return mapToolError(e);
  }
}
