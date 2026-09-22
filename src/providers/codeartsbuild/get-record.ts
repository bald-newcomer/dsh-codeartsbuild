/**
 * codeartsbuild_get_record 工具 handler
 * 对齐 api-contract.md §2.11（ShowJobBuildRecordDetail，GET /v1/record/{job_id}/{build_no}/record-info）
 *
 * 关键输出：build_record_id → record_id（供 get_log）；execution_id；devcloud_project_id；status。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { snakeToCamel, mapRecordStatus } from '../../infra/normalize.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** ShowJobBuildRecordDetail 响应（契约 §2.11 输出示例） */
interface RecordInfoResponse {
  result?: Record<string, unknown>;
}

/** 工具入参 */
export interface GetRecordHandlerInput {
  jobId: string;
  buildNo: number;
}

/**
 * get_record 工具 handler
 */
export async function getRecordHandler(ctx: CloudToolContext, input: GetRecordHandlerInput): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (!input.jobId || input.jobId.trim().length === 0) {
      throw new ToolException('E_PARAM', 'jobId 为空');
    }
    if (input.buildNo === undefined || input.buildNo < 1) {
      throw new ToolException('E_PARAM', `buildNo 非法（≥1），实际: ${input.buildNo}`);
    }

    // ② 直通 HTTP（与 get_status 同 URL，返回全量详情）
    const resp = await ctx.client.call<RecordInfoResponse>(
      { method: 'GET', path: `/v1/record/${input.jobId}/${input.buildNo}/record-info` },
      { idempotent: true },
    );

    // ③ 规范化：camelCase 转换；关键字段映射到顶层（record_id/execution_id/devcloud_project_id）
    const detail = snakeToCamel(resp.result ?? {}) as Record<string, unknown> & {
      buildRecordId?: string;
      executionId?: string;
      devcloudProjectId?: string;
      status?: string;
    };
    if (!detail.buildRecordId) {
      throw new ToolException('E_API', 'ShowJobBuildRecordDetail 响应缺 result.build_record_id', resp);
    }

    return makeSuccessResult(
      {
        ...detail,
        record_id: detail.buildRecordId,
        execution_id: detail.executionId,
        devcloud_project_id: detail.devcloudProjectId,
        status: mapRecordStatus(detail.status),
      },
      `记录已获取: record_id=${detail.buildRecordId}`,
    );
  } catch (e) {
    return mapToolError(e);
  }
}
