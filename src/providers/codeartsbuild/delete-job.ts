/**
 * codeartsbuild_delete_job 工具 handler
 * 对齐 api-contract.md §2.6（DeleteTheJob，HTTP DELETE /v1/job/{job_id}/delete）
 *
 * 不可逆：删除前须用户显式确认（FE-15 §4 机制化，2026-10-23 会话 63534983）——
 * 模型层曾未经确认自行 delete_job。confirm=false（缺省）→ 返回 need_confirmation 引导，
 * 不执行删除；confirm=true（用户显式确认）才真正删除。
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
  /** 用户显式确认删除（默认 false；true 才执行不可逆删除，须经用户确认） */
  confirm?: boolean;
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

    // ①.5 不可逆确认（FE-15 §4：模型层不得未经用户确认直接删除）
    if (!input.confirm) {
      return makeSuccessResult(
        { job_id: input.jobId, deleted: false, reason: 'need_confirmation' },
        `删除构建任务不可逆（jobId=${input.jobId}）——须用户显式确认后携带 confirm=true 重试；如确认删除，请向用户展示任务信息并征得同意`,
      );
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
