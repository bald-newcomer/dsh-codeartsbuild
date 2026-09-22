/**
 * codeartsbuild_get_status 工具 handler
 * 对齐 api-contract.md §2.9（ShowJobBuildRecordDetail，GET /v1/record/{job_id}/{build_no}/record-info）
 *
 * 评审决策（2026-09-18）：get_status 改用 ShowJobBuildRecordDetail（result.status 单值，
 * 实测 STARTED/SUCCESS/FAILED，比 workflow.status 易解析）；ShowJobStepStatus 保留供 wait_build。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { toBuildNo, mapRecordStatus } from '../../infra/normalize.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** ShowJobBuildRecordDetail 响应（契约 §2.9 输出示例） */
interface RecordInfoResponse {
  result?: {
    status?: string;
    build_no?: number | string;
    duration?: number;
    start_time?: string;
    finish_time?: string;
  };
}

/** 工具入参 */
export interface GetStatusHandlerInput {
  jobId: string;
  buildNo: number;
}

/**
 * get_status 工具 handler
 */
export async function getStatusHandler(ctx: CloudToolContext, input: GetStatusHandlerInput): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (!input.jobId || input.jobId.trim().length === 0) {
      throw new ToolException('E_PARAM', 'jobId 为空');
    }
    if (input.buildNo === undefined || input.buildNo < 1) {
      throw new ToolException('E_PARAM', `buildNo 非法（≥1），实际: ${input.buildNo}`);
    }

    // ② 直通 HTTP
    const resp = await ctx.client.call<RecordInfoResponse>(
      { method: 'GET', path: `/v1/record/${input.jobId}/${input.buildNo}/record-info` },
      { idempotent: true },
    );

    // ③ 规范化：状态映射为统一枚举（契约 §4.1）
    const result = resp.result ?? {};
    const status = mapRecordStatus(result.status);
    return makeSuccessResult(
      {
        job_id: input.jobId,
        build_no: toBuildNo(result.build_no) ?? input.buildNo,
        status,
        start_time: result.start_time ?? null,
        end_time: result.finish_time ?? null,
        duration_ms: result.duration ?? null,
      },
      `构建状态: ${status}`,
    );
  } catch (e) {
    return mapToolError(e);
  }
}
