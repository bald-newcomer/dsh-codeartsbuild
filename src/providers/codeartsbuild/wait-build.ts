/**
 * codeartsbuild_wait_build 工具 handler
 * 对齐 api-contract.md §2.14（轮询 ShowJobStepStatus，GET /v1/job/{job_id}/status）
 *
 * 轮询策略：初始 intervalMs → 指数退避 ×1.5（上限 maxBackoffMs）→ 总超时 timeoutMs；
 * 终态（SUCCESS/FAILED/ERROR/CANCELED/COMPLETED）立即返回；
 * 超时返回 status=TIMEOUT + 最后一次已知状态（非异常）；网络抖动单次重试 ≤2 次。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { mapWorkflowStatus, mapRecordStatus, TERMINAL_STATUSES } from '../../infra/normalize.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** ShowJobStepStatus 响应（契约 §8 #3 实测：result.workflow.status + result.flow + result.label） */
interface ShowJobStepStatusResponse {
  result?: {
    workflow?: { status?: string; error?: unknown };
    flow?: unknown;
    label?: unknown;
  };
}

/** 工具入参 */
export interface WaitBuildHandlerInput {
  jobId: string;
  buildNo: number;
  intervalMs?: number;
  timeoutMs?: number;
  maxBackoffMs?: number;
}

/** 默认与边界（契约 §2.14） */
const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 1_800_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

/**
 * 用 ShowJobBuildRecordDetail（GET /v1/record/{job_id}/{build_no}/record-info）复核权威终态
 * 实调发现（2026-09-21）：ShowJobStepStatus 的 completed+error 可能是瞬态（日志 SUCCESS 但 error 有值），
 * record-info 的 result.status（SUCCESS/FAILED/ABORTED）为准。
 */
async function verifyRecordStatus(jobId: string, buildNo: number, client: import('../../infra/http-client.js').HttpClient): Promise<string | null> {
  try {
    const resp = await client.call<{ result?: { status?: string } }>(
      { method: 'GET', path: `/v1/record/${jobId}/${buildNo}/record-info` },
      { idempotent: true, maxRetries: 1 },
    );
    // record-info result.status 为大写（SUCCESS/FAILED/ABORTED）→ 用 mapRecordStatus（§4.1 映射表）
    if (!resp.result?.status) return null;
    return mapRecordStatus(resp.result.status);
  } catch {
    // 复核失败不阻断——保留 step-status 的映射结果
    return null;
  }
}
const NETWORK_RETRY = 2;
const NETWORK_RETRY_DELAY_MS = 2_000;

/** 单次轮询等待（毫秒） */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * wait_build 工具 handler
 */
export async function waitBuildHandler(ctx: CloudToolContext, input: WaitBuildHandlerInput): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (!input.jobId || input.jobId.trim().length === 0) {
      throw new ToolException('E_PARAM', 'jobId 为空');
    }
    if (input.buildNo === undefined || input.buildNo < 1) {
      throw new ToolException('E_PARAM', `buildNo 非法（≥1），实际: ${input.buildNo}`);
    }
    const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS;
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBackoffMs = input.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    if (intervalMs < 2_000 || intervalMs > 120_000) {
      throw new ToolException('E_PARAM', `intervalMs 越界（2000~120000），实际: ${intervalMs}`);
    }
    if (timeoutMs < 60_000 || timeoutMs > 7_200_000) {
      throw new ToolException('E_PARAM', `timeoutMs 越界（60000~7200000），实际: ${timeoutMs}`);
    }

    // ② 轮询循环
    const startTime = Date.now();
    let interval = intervalMs;
    let lastStatus = 'UNKNOWN';
    let lastStartTime: string | null = null;
    // 连续网络失败轮数（偶发抖动被吸收，连续失败超过上限才抛 E_NETWORK——2026-09-21 实调发现单轮网络抖动不应终止轮询）
    let consecutiveNetworkFailures = 0;
    const MAX_CONSECUTIVE_NETWORK_FAILURES = 3;

    while (true) {
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= timeoutMs) {
        // 超时 → 非异常，返回 TIMEOUT + 最后已知状态
        return makeSuccessResult(
          {
            job_id: input.jobId,
            build_no: input.buildNo,
            status: 'TIMEOUT',
            last_status: lastStatus,
            last_start_time: lastStartTime,
            elapsed_ms: elapsedMs,
          },
          `等待超时（${Math.round(elapsedMs / 1000)}s），最后状态: ${lastStatus}`,
        );
      }

      // 单次查询：网络抖动重试 ≤2 次（间隔 2s），不影响退避计数
      let resp: ShowJobStepStatusResponse | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= NETWORK_RETRY; attempt++) {
        try {
          resp = await ctx.client.call<ShowJobStepStatusResponse>(
            {
              method: 'GET',
              path: `/v1/job/${input.jobId}/status`,
              query: { build_no: input.buildNo },
            },
            { idempotent: true, maxRetries: 1 }, // 内层只发 1 次（网络重试由本层 ≤2 次控制；maxRetries=0 会导致 HttpClient 循环不执行抛"未知原因"）
          );
          break;
        } catch (e) {
          lastError = e;
          if (attempt < NETWORK_RETRY) await sleep(NETWORK_RETRY_DELAY_MS);
        }
      }
      if (!resp) {
        // 非网络错误（业务错误如 E_AUTH/E_PARAM）立即抛出
        if (lastError instanceof ToolException && lastError.code !== 'E_NETWORK') throw lastError;
        // 网络错误：连续失败计数，达到上限才终止；否则当作抖动继续下一轮
        consecutiveNetworkFailures++;
        if (consecutiveNetworkFailures >= MAX_CONSECUTIVE_NETWORK_FAILURES) {
          throw new ToolException('E_NETWORK', `wait_build 轮询连续网络失败 ${consecutiveNetworkFailures} 轮`, { job_id: input.jobId });
        }
        await sleep(interval);
        interval = Math.min(interval * 1.5, maxBackoffMs);
        continue;
      }
      consecutiveNetworkFailures = 0;

      // 映射状态（§4.1：running→RUNNING、completed→SUCCESS/FAILED 结合 workflow.error、aborted→CANCELED）
      const workflow = resp.result?.workflow ?? {};
      const rawStatus = workflow.status;
      let mappedStatus = mapWorkflowStatus(rawStatus, workflow.error);
      lastStartTime = lastStartTime ?? null;

      // 实调发现（2026-09-21）：completed + error 非 null 时，workflow.error 可能是瞬态/非终态
      // （日志 Finished: SUCCESS 且 record-info=SUCCESS，但 error 有值 → 误判 FAILED）。
      // 处理：completed + 非取消类 error → 用 ShowJobBuildRecordDetail（record-info）复核权威终态。
      if (rawStatus === 'completed' && workflow.error && mappedStatus === 'FAILED') {
        const verified = await verifyRecordStatus(input.jobId, input.buildNo, ctx.client);
        if (verified) mappedStatus = verified;
      }
      lastStatus = mappedStatus;

      // 终态判定（§4.2）
      if (TERMINAL_STATUSES.has(lastStatus)) {
        return makeSuccessResult(
          {
            job_id: input.jobId,
            build_no: input.buildNo,
            status: lastStatus,
            start_time: null,
            end_time: new Date().toISOString(),
            elapsed_ms: Date.now() - startTime,
          },
          `构建终态: ${lastStatus}（耗时 ${Math.round((Date.now() - startTime) / 1000)}s）`,
        );
      }

      // 未终态 → 退避后继续
      await sleep(interval);
      interval = Math.min(interval * 1.5, maxBackoffMs);
    }
  } catch (e) {
    return mapToolError(e);
  }
}
