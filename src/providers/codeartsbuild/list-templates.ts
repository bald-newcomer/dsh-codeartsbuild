/**
 * codeartsbuild_list_templates 工具 handler
 * 对齐 api-contract.md §2.13（ListCustomTemplate，GET /v1/template/custom）
 *
 * 职责（FE-07 O2，2026-09-23 实调确认）：
 * - 查询**用户自定义模板**（ListCustomTemplate），供创建构建任务前检查
 *   "是否有可直接使用的用户自建模板"（FE-07 §2.2 用户澄清：官方模板 ListOfficialTemplate
 *   仅作 step-templates.json 离线初始化数据源，不在本工具查询范围）
 * - 规范化：result.items[] → templates[]（template.steps 提取到顶层）；total_size → total。
 * - steps[].module_id 为全限定名，可直接作为 create_job.steps 入参（白名单校验见组装器）。
 *
 * 接口实测（2026-09-23）：
 * - URL: GET /v1/template/custom（metaRepo YAML + 真实 HTTP 实调）
 * - 参数：filter(string)? / name(string)? / page(int,≥1)? / page_size(int,≤100)? / tags(string)?
 * - 响应：result.items[] + result.total_size（与 ListOfficialTemplate 同构，实调确认）
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** ListCustomTemplate 响应（2026-09-23 实调确认，与 ListOfficialTemplate 同构） */
interface ListCustomTemplateResponse {
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
}

/**
 * list_templates 工具 handler（查用户自定义模板）
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
      throw new ToolException('E_PARAM', `page 非法（≥1，实调确认），实际: ${input.page}`);
    }
    if (input.pageSize !== undefined && (input.pageSize < 1 || input.pageSize > 100)) {
      throw new ToolException('E_PARAM', `pageSize 越界（1~100），实际: ${input.pageSize}`);
    }

    // ② 直通 HTTP（ListCustomTemplate；page/page_size 实调为 integer，直接传数字）
    const resp = await ctx.client.call<ListCustomTemplateResponse>(
      {
        method: 'GET',
        path: '/v1/template/custom',
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

    // ③ 规范化：items[] → templates[]（template.steps 提取到顶层，与官方模板同构）
    const rawItems = resp.result?.items ?? [];
    const templates = rawItems.map((item) => {
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
    });

    return makeSuccessResult(
      { templates, total: resp.result?.total_size ?? templates.length },
      `共 ${resp.result?.total_size ?? templates.length} 个用户自定义模板`,
    );
  } catch (e) {
    return mapToolError(e);
  }
}
