/**
 * codeartsbuild_list_projects 工具 handler
 * 对齐 api-contract.md §2.1（ShowRelatedProject，GET /v1/domain/project/related）
 *
 * 规范化：result.project_info_list[].identifier → projectId；顶层加 total。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { snakeToCamel } from '../../infra/normalize.js';
import type { ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** ShowRelatedProject 响应（契约 §2.1 输出示例） */
interface ShowRelatedProjectResponse {
  result?: {
    total?: number;
    project_info_list?: Array<Record<string, unknown>>;
  };
}

/** 工具入参（无） */
export type ListProjectsHandlerInput = Record<string, never>;

/**
 * list_projects 工具 handler
 */
export async function listProjectsHandler(ctx: CloudToolContext): Promise<ToolResult> {
  try {
    const resp = await ctx.client.call<ShowRelatedProjectResponse>(
      { method: 'GET', path: '/v1/domain/project/related' },
      { idempotent: true },
    );

    const rawList = resp.result?.project_info_list ?? [];
    const projects = rawList.map((item) => {
      const camel = snakeToCamel(item);
      // identifier → projectId（契约 §2.1 字段映射）
      return { ...camel, projectId: camel.identifier ?? undefined };
    });

    const data = {
      total: resp.result?.total ?? projects.length,
      projects,
    };
    return makeSuccessResult(data, `共 ${data.total} 个项目`);
  } catch (e) {
    return mapToolError(e);
  }
}
