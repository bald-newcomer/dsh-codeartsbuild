/**
 * codeartsbuild_list_jobs 工具 handler
 * 对齐 api-contract.md §2.2（ListJob，GET /v1/job/list）
 *
 * 校验：pageIndex 0~1e9；pageSize 1~100；buildStatus ∈ 枚举。
 * 规范化：result.job_list[].id → jobId；last_build_time 毫秒→ISO；输出 {jobs, total}。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { snakeToCamel, toIso, mapJobLastStatus } from '../../infra/normalize.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** ListJob 响应（契约 §2.2 输出示例） */
interface ListJobResponse {
  result?: {
    total?: number;
    job_list?: Array<Record<string, unknown>>;
  };
}

/** 工具入参 */
export interface ListJobsHandlerInput {
  pageIndex?: number;
  pageSize?: number;
  search?: string;
  buildStatus?: string;
  sortField?: string;
  sortOrder?: string;
  creatorId?: string;
}

/** openapi 枚举：build_status */
const BUILD_STATUS_ENUM = ['aborted', 'InQueue', 'building', 'red', 'blue', 'none'];

/**
 * list_jobs 工具 handler
 */
export async function listJobsHandler(ctx: CloudToolContext, input: ListJobsHandlerInput): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (input.pageIndex !== undefined && (input.pageIndex < 0 || input.pageIndex > 1e9)) {
      throw new ToolException('E_PARAM', `pageIndex 越界（0~1e9），实际: ${input.pageIndex}`);
    }
    if (input.pageSize !== undefined && (input.pageSize < 1 || input.pageSize > 100)) {
      throw new ToolException('E_PARAM', `pageSize 越界（1~100），实际: ${input.pageSize}`);
    }
    if (input.buildStatus !== undefined && !BUILD_STATUS_ENUM.includes(input.buildStatus)) {
      throw new ToolException('E_PARAM', `buildStatus 非法，枚举: ${BUILD_STATUS_ENUM.join(' | ')}`);
    }

    // ② 直通 HTTP（query 参数与 openapi 对齐）
    const resp = await ctx.client.call<ListJobResponse>(
      {
        method: 'GET',
        path: '/v1/job/list',
        query: {
          page_index: input.pageIndex,
          page_size: input.pageSize,
          search: input.search,
          build_status: input.buildStatus,
          sort_field: input.sortField,
          sort_order: input.sortOrder,
          creator_id: input.creatorId,
        },
      },
      { idempotent: true },
    );

    // ③ 规范化：job_list → jobs，id → jobId，last_build_time → ISO，last_build_status → 统一枚举
    const rawJobs = resp.result?.job_list ?? [];
    const jobs = rawJobs.map((job) => {
      const camel = snakeToCamel(job);
      const lastBuildTime = toIso(camel.lastBuildTime as number | null | undefined);
      return {
        ...camel,
        jobId: camel.id ?? undefined,
        lastBuildTime,
        status: mapJobLastStatus(camel.lastBuildStatus as string | null | undefined),
      };
    });

    return makeSuccessResult(
      { jobs, total: resp.result?.total ?? jobs.length },
      `共 ${resp.result?.total ?? jobs.length} 个构建任务`,
    );
  } catch (e) {
    return mapToolError(e);
  }
}
