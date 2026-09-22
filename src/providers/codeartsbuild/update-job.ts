/**
 * codeartsbuild_update_job 工具 handler
 * 对齐 api-contract.md §2.5（UpdateNewJob，POST /v1/job/update）
 *
 * 语义：全量覆盖提交（非增量）——模型须先 get_job 取原配置再修改后整体提交。
 * body 与 create_job 同构（camelCase），经 assembleConfig 组装为 snake_case 请求体。
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

/** 工具入参 */
export interface UpdateJobHandlerInput {
  jobId: string;
  body: CreateJobInput;
}

/**
 * update_job 工具 handler
 */
export async function updateJobHandler(ctx: CloudToolContext, input: UpdateJobHandlerInput): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (!input.jobId || input.jobId.trim().length === 0) {
      throw new ToolException('E_PARAM', 'jobId 为空');
    }
    const body = input.body ?? {};
    if (typeof body !== 'object' || Object.keys(body).length === 0) {
      throw new ToolException('E_PARAM', 'body 为空对象', '全量覆盖语义：须先 get_job 取原配置，修改后整体提交');
    }
    // body 缺核心字段（arch/jobName/steps 三选一）→ E_PARAM（assembleConfig 校验 steps；此处补 arch/jobName）
    if (!body.arch || !body.jobName) {
      throw new ToolException('E_PARAM', 'body 缺核心字段', '全量覆盖语义：body 须含 arch/jobName/steps（或 stepsPlan/language）');
    }

    // ② projectId 解析（body.projectId 显式 > 会话 > 配置）
    const projectId = resolveProjectId(body.projectId, ctx.session, ctx.envProjectId);

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
