/**
 * codeartsbuild_delete_job 工具 handler
 * 对齐 api-contract.md §2.6（DeleteTheJob，HTTP DELETE /v1/job/{job_id}/delete）
 *
 * 不可逆：删除前确认由模型层完成（SKILL 强制约束 #4），工具不重复校验。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** DeleteTheJob 响应（契约 §2.6 输出示例） */
interface DeleteTheJobResponse {
  result?: { job_id?: string; project_id?: string };
}

/** 工具入参 */
export interface DeleteJobHandlerInput {
  jobId: string;
}

/**
 * delete_job 工具 handler
 */
export async function deleteJobHandler(ctx: CloudToolContext, input: DeleteJobHandlerInput): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (!input.jobId || input.jobId.trim().length === 0) {
      throw new ToolException('E_PARAM', 'jobId 为空');
    }

    // ② 直通 HTTP（openapi 实测为 HTTP DELETE，无 body）
    const resp = await ctx.client.call<DeleteTheJobResponse>(
      { method: 'DELETE', path: `/v1/job/${input.jobId}/delete` },
      { idempotent: true },
    );

    // ③ 规范化：result.job_id（缺省回填输入 jobId）
    const jobId = resp.result?.job_id ?? input.jobId;
    return makeSuccessResult({ job_id: jobId, deleted: true }, `删除构建任务成功: jobId=${jobId}`);
  } catch (e) {
    return mapToolError(e);
  }
}
