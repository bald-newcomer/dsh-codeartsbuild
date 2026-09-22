/**
 * codeartsbuild_get_job 工具 handler
 * 对齐 api-contract.md §2.3（ShowJobConfig，GET /v1/job/{job_id}/config）
 *
 * 规范化：保留 result 主体（camelCase）；steps[].module_id 为全限定名。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { snakeToCamel } from '../../infra/normalize.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** ShowJobConfig 响应（契约 §2.3 输出示例） */
interface ShowJobConfigResponse {
  result?: Record<string, unknown>;
}

/** 工具入参 */
export interface GetJobHandlerInput {
  jobId: string;
  getAllParams?: string;
}

/**
 * get_job 工具 handler
 */
export async function getJobHandler(ctx: CloudToolContext, input: GetJobHandlerInput): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (!input.jobId || input.jobId.trim().length === 0) {
      throw new ToolException('E_PARAM', 'jobId 为空');
    }
    if (input.jobId.length > 64) {
      throw new ToolException('E_PARAM', `jobId 长度非法（≤64），实际: ${input.jobId.length}`);
    }

    // ② 直通 HTTP
    const resp = await ctx.client.call<ShowJobConfigResponse>(
      {
        method: 'GET',
        path: `/v1/job/${input.jobId}/config`,
        query: { get_all_params: input.getAllParams },
      },
      { idempotent: true },
    );

    // ③ 规范化：camelCase 转换，保留 result 主体
    // 契约标识（steps[].module_id / scms[].scm_type）保持 snake_case，供 create_job.steps 直接 round-trip
    const detail = snakeToCamel(resp.result ?? {}, new Set(['module_id', 'scm_type']));
    return makeSuccessResult(detail, `任务 ${input.jobId} 配置已获取`);
  } catch (e) {
    return mapToolError(e);
  }
}
