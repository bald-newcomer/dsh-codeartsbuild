/**
 * codeartsbuild_create_job 工具 handler
 * 对齐 tool-details.md §3.5 handler 流程 + api-contract.md §2.4 契约
 *
 * 流程：
 * ① 参数校验（schemastery 已拦必填/类型，此处补业务校验）
 * ② projectId 会话注入（resolveProjectId：显式 > 会话 > 配置，统一刷新会话）
 * ③ steps 组装（assembleConfig：显式 steps / stepsPlan / language）
 * ④ module_id 白名单校验（assembleConfig 内部）
 * ⑤ 自建 HTTP 调 POST /v1/job/create（AK/SK 签名，全契约字段直传）
 * ⑥ 成功 → {job_id, created: true}；失败 → 透传 E_API
 */
import { HttpClient } from '../../infra/http-client.js';
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { resolveProjectId } from '../../core/session.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { ScmInfo, ParameterGroup } from '../../core/types.js';
import { assembleConfig } from './template-assembler.js';
import type { CloudToolContext } from './context.js';

/** CreateNewJob HTTP 响应（契约 §2.4 输出示例） */
interface CreateNewJobResponse {
  result?: { job_id?: string };
  error?: unknown;
  status?: string;
}

/** 工具入参（schemastery schema 校验后） */
export interface CreateJobHandlerInput {
  projectId?: string;
  jobName: string;
  arch: 'x86-64' | 'arm';
  stepsPlan?: Array<{ step: string; properties?: Record<string, unknown> }>;
  language?: string;
  steps?: Array<{
    module_id: string;
    name: string;
    properties?: Record<string, unknown>;
    enable?: boolean;
  }>;
  scms?: ScmInfo[];
  parameters?: ParameterGroup[];
  description?: string;
  flavor?: string;
  hostType?: string;
  buildConfigType?: string;
  sourceCode?: string;
  buildIfCodeUpdated?: boolean;
  autoUpdateSubModule?: string;
  agencyUrn?: string;
  groupId?: string;
}

/** 工具上下文（含 HTTP 客户端 + 会话）——复用云侧共享上下文 */
export type CreateJobToolContext = CloudToolContext;

/**
 * create_job 工具 handler
 */
export async function createJobHandler(
  ctx: CreateJobToolContext,
  input: CreateJobHandlerInput,
): Promise<ToolResult> {
  try {
    // ① 业务校验：jobName 长度
    if (!input.jobName || input.jobName.length > 115) {
      throw new ToolException('E_PARAM', `jobName 长度非法（1~115），实际: ${input.jobName?.length ?? 0}`);
    }
    // ② projectId 会话注入
    const projectId = resolveProjectId(input.projectId, ctx.session, ctx.envProjectId);

    // ③ steps 组装 + ④ 白名单校验（assembleConfig 内部完成）
    const requestBody = assembleConfig({
      projectId,
      jobName: input.jobName,
      arch: input.arch,
      stepsPlan: input.stepsPlan,
      language: input.language,
      steps: input.steps,
      scms: input.scms,
      parameters: input.parameters,
      description: input.description,
      flavor: input.flavor,
      hostType: input.hostType,
      buildConfigType: input.buildConfigType,
      sourceCode: input.sourceCode,
      buildIfCodeUpdated: input.buildIfCodeUpdated,
      autoUpdateSubModule: input.autoUpdateSubModule,
      agencyUrn: input.agencyUrn,
      groupId: input.groupId,
    });

    // ⑤ 自建 HTTP 调 POST /v1/job/create（契约 §2.4 URL）
    // 全契约字段直传（含 description/source_code/agency_urn——SDK 模型类曾静默丢弃这些字段）
    const response = await ctx.client.call<CreateNewJobResponse>(
      {
        method: 'POST',
        path: '/v1/job/create',
        body: requestBody,
      },
      { idempotent: false },
    );

    // ⑥ 解析 result.job_id
    const jobId = response.result?.job_id;
    if (!jobId) {
      throw new ToolException('E_API', 'CreateNewJob 成功但响应缺 result.job_id', response);
    }

    return makeSuccessResult({ job_id: jobId, created: true }, `创建构建任务成功: jobId=${jobId}`);
  } catch (e) {
    return mapToolError(e, 'E_API');
  }
}
