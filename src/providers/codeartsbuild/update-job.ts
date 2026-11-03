/**
 * codeartsbuild_update_job 工具 handler
 * 对齐 api-contract.md §2.5（UpdateNewJob，POST /v1/job/update）
 *
 * 语义：全量覆盖提交（非增量）——模型须先 get_job 取原配置再修改后整体提交。
 * body 与 create_job 同构（camelCase），经 assembleConfig 组装为 snake_case 请求体。
 *
 * projectId 兜底链（FE-13 §2.1，2026-10-16 会话 58dccf5f P0）：
 *   body.projectId 显式 > 会话上下文 > 配置默认值 > get_job 回读原任务配置 > E_PARAM
 *   会话证据：模型组装 body 漏带 projectId 且会话/配置无值 → 旧实现直接 E_PARAM 致全流程中断。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { resolveProjectId } from '../../core/session.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CreateJobInput } from '../../core/types.js';
import { assembleConfig } from './template-assembler.js';
import type { CloudToolContext } from './context.js';

/** UpdateNewJob 响应（契约 §2.5 输出示例） */
interface UpdateNewJobResponse {
  result?: { job_id?: string };
}

/** ShowJobConfig 响应（契约 §2.3；仅取 project_id 兜底用） */
interface ShowJobConfigResponse {
  result?: Record<string, unknown>;
}

/** 工具入参 */
export interface UpdateJobHandlerInput {
  jobId: string;
  body: CreateJobInput;
}

/**
 * projectId 解析（FE-13 §2.1）：显式 > 会话 > 配置，全空返回 undefined（不抛错，交 get_job 回读兜底）
 * resolveProjectId 会抛 E_PARAM；此处捕获后返回空，让调用方走 get_job 回读分支。
 */
function resolveProjectIdQuiet(
  explicit: string | undefined,
  session: import('../../core/session.js').SessionContext | undefined,
  envDefault: string | undefined,
): string | undefined {
  try {
    return resolveProjectId(explicit, session, envDefault);
  } catch {
    return undefined;
  }
}

/**
 * 回读原任务配置取 project_id（FE-13 §2.1 兜底链第 4 级）
 * - 成功 → 返回 projectId；任务不存在/响应无 project_id → 返回 undefined（不抛，交上层 E_PARAM）
 * - 注意：此处 HTTP 错误（E_API）不吞——回读失败但确有任务时仍应报 E_API 而非 E_PARAM，
 *   仅"任务不存在/无 project_id 字段"这类数据缺失才归 E_PARAM 引导。
 */
async function fetchJobConfigProjectId(ctx: CloudToolContext, jobId: string): Promise<string | undefined> {
  let resp: ShowJobConfigResponse;
  try {
    resp = await ctx.client.call<ShowJobConfigResponse>(
      { method: 'GET', path: `/v1/job/${jobId}/config`, query: { get_all_params: 'true' } },
      { idempotent: true },
    );
  } catch (e) {
    // 任务不存在（404/仓库不存在）→ 数据缺失，走 E_PARAM 引导；其余 HTTP 错误透传
    if (e instanceof ToolException && (e.code === 'E_PARAM' || /不存在|已被删除/i.test(String(e.details ?? e.message)))) {
      return undefined;
    }
    throw e;
  }
  const projectId = (resp.result?.project_id as string | undefined) ?? (resp.result?.projectId as string | undefined);
  return projectId?.trim() ? projectId : undefined;
}

/**
 * update_job 工具 handler
 */
export async function updateJobHandler(ctx: CloudToolContext, input: UpdateJobHandlerInput): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (!input.jobId || input.jobId.trim().length === 0) {
      throw new ToolException('E_PARAM', 'jobId 为空', 'update_job 须先 get_job 取原配置（jobId 来自 get_job/list_jobs 返回）');
    }
    const body = input.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length === 0) {
      throw new ToolException(
        'E_PARAM',
        `body 非法（须为对象，实际: ${typeof body}）`,
        '全量覆盖语义：先 get_job 取原配置，修改后整体提交——body 必须为对象且非空（含 arch/jobName/steps 或 stepsPlan/language 等核心字段）',
      );
    }
    // body 缺核心字段（arch/jobName/steps 三选一）→ E_PARAM（assembleConfig 校验 steps；此处补 arch/jobName）
    if (!body.arch || !body.jobName) {
      throw new ToolException('E_PARAM', 'body 缺核心字段', '全量覆盖语义：body 须含 arch/jobName/steps（或 stepsPlan/language）——先 get_job 取原配置再改，禁止手拼残缺 body');
    }

    // ② projectId 解析（body.projectId 显式 > 会话 > 配置 > get_job 回读）
    let projectId = resolveProjectIdQuiet(body.projectId, ctx.session, ctx.envProjectId);
    if (!projectId) {
      // FE-13 §2.1：兜底链未命中 → 回读原任务配置取 project_id（全量覆盖语义下 update_job 本就要求先 get_job）
      const jobConfig = await fetchJobConfigProjectId(ctx, input.jobId);
      if (jobConfig) {
        projectId = jobConfig;
        // 回读成功统一刷新会话（显式/env 来源进入会话，后续复用）
        if (ctx.session) ctx.session.projectId = projectId;
      } else {
        throw new ToolException(
          'E_PARAM',
          'projectId 缺省且会话上下文/配置默认值/get_job 回读均无值',
          '请显式传 projectId，或先调 get_job 取原配置（body 含 get_job 返回的 projectId 字段）后重试',
        );
      }
    }

    // ③ 组装请求体（与 create_job 同构；module_id 白名单校验在 assembleConfig 内部）
    const requestBody = {
      ...assembleConfig({ ...body, projectId }),
      job_id: input.jobId,
    };

    // ④ 直通 HTTP
    const resp = await ctx.client.call<UpdateNewJobResponse>(
      { method: 'POST', path: '/v1/job/update', body: requestBody },
      { idempotent: false },
    );

    // ⑤ 解析 result.job_id
    const jobId = resp.result?.job_id ?? input.jobId;
    return makeSuccessResult({ job_id: jobId, updated: true }, `更新构建任务成功: jobId=${jobId}`);
  } catch (e) {
    return mapToolError(e);
  }
}
