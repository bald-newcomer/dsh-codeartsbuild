/**
 * codeartsbuild_get_log 工具 handler
 * 对齐 api-contract.md §2.15（DownloadBuildFullLog，GET /v1/log/{record_id}/download-log）+ FE-02-日志清洗器规范-20260918.md
 *
 * 流程：recordId 校验 → HTTP 下载（rawBinary）→ ZIP 识别解压（PK 头，取 message.txt）→ 清洗建模。
 * 调用约束：仅构建失败或用户显式要求时调用（SKILL 强制约束 #5）。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { cleanLog } from '../../infra/log-cleaner.js';
import { extractLogText } from '../../infra/zip.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** 工具入参 */
export interface GetLogHandlerInput {
  recordId: string;
  logLevel?: string;
  maxBytes?: number;
  compress?: boolean;
}

/** record_id 校验：36 位数字、小写字母、'-'（metaRepo 实测） */
const RECORD_ID_RE = /^[0-9a-z-]{36}$/;

/**
 * get_log 工具 handler
 */
export async function getLogHandler(ctx: CloudToolContext, input: GetLogHandlerInput): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (!input.recordId || !RECORD_ID_RE.test(input.recordId)) {
      throw new ToolException('E_PARAM', `recordId 非法（36 位 UUID），实际: ${input.recordId}`);
    }
    if (input.logLevel !== undefined && input.logLevel !== 'INFO' && input.logLevel !== 'DEBUG') {
      throw new ToolException('E_PARAM', `logLevel 非法，枚举: INFO | DEBUG`);
    }
    if (input.maxBytes !== undefined && (input.maxBytes < 1024 || input.maxBytes > 5 * 1024 * 1024)) {
      throw new ToolException('E_PARAM', `maxBytes 越界（1KB~5MB），实际: ${input.maxBytes}`);
    }

    // ② HTTP 下载（二进制返回，rawBinary）
    const bytes = await ctx.client.call<ArrayBuffer>(
      {
        method: 'GET',
        path: `/v1/log/${input.recordId}/download-log`,
        query: {
          log_level: input.logLevel,
          compress: input.compress,
        },
      },
      { idempotent: true, rawBinary: true },
    );

    // ③ ZIP 识别解压 → 主日志文本
    const { text } = extractLogText(new Uint8Array(bytes));

    // ④ 清洗建模
    const cleaned = cleanLog({ rawLog: text, maxBytes: input.maxBytes ?? 262_144, errorFocus: true });

    return makeSuccessResult(
      {
        record_id: input.recordId,
        byte_size: cleaned.byte_size,
        truncated: cleaned.truncated,
        raw_sample: cleaned.raw_sample,
        structured: cleaned.structured,
        error_summary: cleaned.error_summary,
        job_key: cleaned.job_key,
        resource_pool: cleaned.resource_pool,
        steps: cleaned.steps,
        finished: cleaned.finished,
        task_states: cleaned.task_states,
      },
      `日志已获取: ${cleaned.byte_size} bytes${cleaned.truncated ? '（已截断）' : ''}`,
    );
  } catch (e) {
    return mapToolError(e);
  }
}
