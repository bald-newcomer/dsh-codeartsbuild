/**
 * codeartsbuild_list_records 工具 handler
 * 对齐 api-contract.md §2.10（ListRecords，GET /v1/record/{build_project_id}/records）
 *
 * 校验：buildProjectId 为 36 位 UUID（= ListJob 返回的 build_project_id，非 32 位 project_id，
 * 2026-09-18 实调用确认，契约 §8 #5）；page ≥ 0；limit 1~100。
 * 会话注入：buildProjectId 缺省时取会话上下文；显式传入覆盖。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { snakeToCamel, toBuildNo, mapRecordStatus } from '../../infra/normalize.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** ListRecords 响应（契约 §2.10 输出示例） */
interface ListRecordsResponse {
  result?: {
    pagination?: { page?: number; limit?: number; total?: number };
    data?: Array<Record<string, unknown>>;
  };
}

/** 工具入参 */
export interface ListRecordsHandlerInput {
  buildProjectId?: string;
  page?: number;
  limit?: number;
  triggers?: string[];
  branches?: string[];
  tags?: string[];
  fromDate?: string;
  toDate?: string;
}

/** 36 位 UUID 校验（build_project_id 格式） */
const UUID36_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * list_records 工具 handler
 */
export async function listRecordsHandler(ctx: CloudToolContext, input: ListRecordsHandlerInput): Promise<ToolResult> {
  try {
    // ① buildProjectId 解析：显式 > 会话 > 报错（36 位 UUID 校验）
    let buildProjectId = input.buildProjectId?.trim();
    if (!buildProjectId && ctx.session?.projectId?.trim()) {
      buildProjectId = ctx.session.projectId.trim();
    }
    if (!buildProjectId) {
      throw new ToolException(
        'E_PARAM',
        'buildProjectId 缺省且会话上下文无值',
        '请显式传 buildProjectId（36 位 UUID，取自 list_jobs 返回的 build_project_id），或先调 list_jobs 获取',
      );
    }
    if (!UUID36_RE.test(buildProjectId)) {
      throw new ToolException(
        'E_PARAM',
        `buildProjectId 非法（须为 36 位 UUID），实际: ${buildProjectId}`,
        'buildProjectId = list_jobs 返回的 build_project_id（36 位 UUID），非 32 位 project_id',
      );
    }

    // ② 分页校验
    if (input.page !== undefined && input.page < 0) {
      throw new ToolException('E_PARAM', `page 非法（≥0），实际: ${input.page}`);
    }
    if (input.limit !== undefined && (input.limit < 1 || input.limit > 100)) {
      throw new ToolException('E_PARAM', `limit 越界（1~100），实际: ${input.limit}`);
    }

    // ③ 直通 HTTP（分页 page+limit，非 offset）
    const resp = await ctx.client.call<ListRecordsResponse>(
      {
        method: 'GET',
        path: `/v1/record/${buildProjectId}/records`,
        query: {
          page: input.page,
          limit: input.limit,
          triggers: input.triggers,
          branches: input.branches,
          tags: input.tags,
          from_date: input.fromDate,
          to_date: input.toDate,
        },
      },
      { idempotent: true },
    );

    // ④ 规范化：data → records[]（camelCase，build_no→buildNo，status→统一枚举）
    const rawRecords = resp.result?.data ?? [];
    const records = rawRecords.map((rec) => {
      const camel = snakeToCamel(rec);
      return {
        ...camel,
        buildNo: toBuildNo(camel.buildNo as unknown) ?? camel.buildNo,
        status: mapRecordStatus(camel.status as string | null | undefined),
      };
    });

    const pagination = resp.result?.pagination ?? { total: records.length };
    return makeSuccessResult(
      { records, ...pagination },
      `共 ${pagination.total ?? records.length} 条构建记录`,
    );
  } catch (e) {
    return mapToolError(e);
  }
}
