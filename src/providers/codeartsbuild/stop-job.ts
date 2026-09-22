/**
 * codeartsbuild_stop_job 工具 handler
 * 对齐 api-contract.md §2.8（StopTheJob，POST /v1/job/{job_id}/stop，body {build_no}）
 *
 * 原始响应仅 {status: success}；工具层回填入参输出 {job_id, build_no, stopped: true}。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** StopTheJob 响应（契约 §2.8 输出示例） */
interface StopTheJobResponse {
  status?: string;
}

/** 工具入参 */
export interface StopJobHandlerInput {
  jobId: string;
  buildNo: number;
}

/**
 * stop_job 工具 handler
 */
export async function stopJobHandler(ctx: CloudToolContext, input: StopJobHandlerInput): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (!input.jobId || input.jobId.trim().length === 0) {
      throw new ToolException('E_PARAM', 'jobId 为空');
    }
    if (input.buildNo === undefined || input.buildNo < 1) {
      throw new ToolException('E_PARAM', `buildNo 非法（≥1），实际: ${input.buildNo}`);
    }

    // ② 直通 HTTP（openapi 实测：body {build_no}，见契约 §2.8）
    await ctx.client.call<StopTheJobResponse>(
      {
        method: 'POST',
        path: `/v1/job/${input.jobId}/stop`,
        body: { build_no: input.buildNo },
      },
      { idempotent: false },
    );

    // ③ 规范化：原始响应无 job_id/build_no，回填入参
    return makeSuccessResult(
      { job_id: input.jobId, build_no: input.buildNo, stopped: true },
      `停止构建已提交: jobId=${input.jobId} buildNo=${input.buildNo}`,
    );
  } catch (e) {
    return mapToolError(e);
  }
}
