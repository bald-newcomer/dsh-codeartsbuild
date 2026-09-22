/**
 * codeartsbuild_list_templates 工具 handler
 * 对齐 api-contract.md §2.13（ListOfficialTemplate，GET /v1/template/officialtemplates）
 *
 * 规范化：result.items[] → templates[]（steps 提取到顶层）；total_size → total。
 * steps[].module_id 为全限定名，可直接作为 create_job.steps 入参。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** ListOfficialTemplate 响应（契约 §2.13 输出示例） */
interface ListOfficialTemplateResponse {
  result?: {
    items?: Array<Record<string, unknown>>;
    total_size?: number;
  };
}

/** 工具入参 */
export interface ListTemplatesHandlerInput {
  name?: string;
  page?: number;
  pageSize?: number;
}

/**
 * list_templates 工具 handler
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
    if (input.page !== undefined && input.page < 0) {
      throw new ToolException('E_PARAM', `page 非法（≥0），实际: ${input.page}`);
    }
    if (input.pageSize !== undefined && (input.pageSize < 1 || input.pageSize > 100)) {
      throw new ToolException('E_PARAM', `pageSize 越界（1~100），实际: ${input.pageSize}`);
    }

    // ② 直通 HTTP（page/page_size openapi 为 string，适配层转 string 传参）
    const resp = await ctx.client.call<ListOfficialTemplateResponse>(
      {
        method: 'GET',
        path: '/v1/template/officialtemplates',
        query: {
          name: input.name,
          page: input.page !== undefined ? String(input.page) : undefined,
          page_size: input.pageSize !== undefined ? String(input.pageSize) : undefined,
        },
      },
      { idempotent: true },
    );

    // ③ 规范化：items[] → templates[]（template.steps 提取到顶层）
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
        steps: template.steps ?? [],
        parameters: item.parameters ?? [],
      };
    });

    return makeSuccessResult(
      { templates, total: resp.result?.total_size ?? templates.length },
      `共 ${resp.result?.total_size ?? templates.length} 个官方模板`,
    );
  } catch (e) {
    return mapToolError(e);
  }
}
