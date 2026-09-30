/**
 * codeartsbuild_create_job 工具 handler
 * 对齐 FE-03-工具详细设计-20260918.md §3.5 handler 流程 + api-contract.md §2.4 契约
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
import { makeSuccessResult, makeErrorResult, mapToolError } from '../../infra/tool-result.js';
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

/**
 * scm 字段来源校验（FE-07 §2.5 O5：来源强制，禁止臆造）
 * - scm_type 实测唯一支持 `codehub`（CodeArtsRepo）；gitlab/github/gitee 等未实测，禁用
 * - repo_id 必须存在（来源渠道：建仓返回 / get_job 回读 / 本地远端解析）
 * - 拒绝第三方 Git 平台 URL（CodeArts Build 只认 CodeArtsRepo）
 */
function validateScms(scms?: ScmInfo[]): void {
  if (!scms || scms.length === 0) return;

  for (const scm of scms) {
    const raw = scm as unknown as Record<string, unknown>;
    const scmType = (raw.scm_type ?? raw.scmType ?? '') as string;
    if (!scmType) {
      throw new ToolException(
        'E_PARAM',
        'create_job.scms[].scm_type 必填',
        'scm_type 仅支持实测的 codehub（CodeArtsRepo）；请从建仓返回 / get_job 回读 / 本地远端解析获取，禁止臆造（gitlab/github/gitee 等未实测禁用）',
      );
    }
    if (scmType !== 'codehub') {
      throw new ToolException(
        'E_PARAM',
        `create_job.scms[].scm_type="${scmType}" 不受支持`,
        'CodeArts Build 仅支持实测的 codehub（CodeArtsRepo）仓库；gitlab/github/gitee 等未实测禁用。请改用 codehub 或转人工确认仓库来源',
      );
    }

    const repoId = (raw.repo_id ?? raw.repoId ?? '') as string;
    if (!repoId) {
      throw new ToolException(
        'E_PARAM',
        'create_job.scms[].repo_id 必填',
        'repo_id 必须取自正确前置渠道：① CodeArtsRepo 建仓返回 ② get_job/list_jobs 已有任务回读 ③ 本地仓库已有远端解析。来源不明 → 转人工确认，禁止臆造',
      );
    }

    // 拒绝第三方 Git 平台 URL（CodeArts Build 只认 CodeArtsRepo）
    const url = (raw.url ?? '') as string;
    if (url && /github\.com|gitlab\.com|gitee\.com/i.test(url)) {
      throw new ToolException(
        'E_PARAM',
        `create_job.scms[].url="${url}" 为第三方 Git 平台地址，不受支持`,
        'CodeArts Build 仅识别 CodeArtsRepo（codehub）仓库；url 须为 CodeArtsRepo 仓库地址（建仓返回 / 已有任务回读），禁止填 GitHub/gitlab 等第三方地址',
      );
    }
  }
}

/** CreateNewJob 请求体（snake_case scm 字段，与契约 §2.4 一致） */
function toRequestScms(scms?: ScmInfo[]): Record<string, unknown>[] | undefined {
  if (!scms || scms.length === 0) return undefined;
  return scms.map((scm) => {
    const raw = scm as unknown as Record<string, unknown>;
    // 契约字段 snake_case（scm_type/repo_id/repo_name/branch/url/web_url/build_type），
    // 兼容 camelCase 入参（scmType/repoId/repoName/webUrl/buildType）做映射
    return {
      scm_type: raw.scm_type ?? raw.scmType,
      repo_id: raw.repo_id ?? raw.repoId,
      repo_name: raw.repo_name ?? raw.repoName,
      branch: raw.branch,
      url: raw.url,
      web_url: raw.web_url ?? raw.webUrl,
      build_type: raw.build_type ?? raw.buildType,
      build_commit_id: raw.build_commit_id ?? raw.buildCommitId,
      build_tag: raw.build_tag ?? raw.buildTag,
    };
  });
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
    // ① 业务校验：jobName 长度 + 字符集（2026-09-29：支持中英文/数字/下划线/连字符，≤115）
    if (!input.jobName || input.jobName.length > 115) {
      throw new ToolException('E_PARAM', `jobName 长度非法（1~115），实际: ${input.jobName?.length ?? 0}`);
    }
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]+$/.test(input.jobName)) {
      throw new ToolException(
        'E_PARAM',
        `jobName 字符集非法: "${input.jobName}"——仅支持中英文、数字、下划线 _、连字符 -（长度 1~115）`,
      );
    }
    // ①.5 flavor 校验：仅 DEFAULT 合法（2026-09-29 用户确认：目前只有 DEFAULT 合法，1cpu4g/2u8g 非当前枚举）
    const FLAVORS = ['DEFAULT'] as const;
    const flavor = input.flavor ?? 'DEFAULT';
    if (!FLAVORS.includes(flavor as (typeof FLAVORS)[number])) {
      throw new ToolException('E_PARAM', `flavor 非法: "${flavor}"——当前仅支持 DEFAULT（缺省即 DEFAULT）`);
    }
    // ② projectId 会话注入
    const projectId = resolveProjectId(input.projectId, ctx.session, ctx.envProjectId);

    // ②.5 scm 字段来源校验（FE-07 §2.5 O5：禁止臆造 scm_type/repo_id/第三方 URL）
    validateScms(input.scms);

    // ③ steps 组装 + ④ 白名单校验（assembleConfig 内部完成）
    const requestBody = assembleConfig({
      projectId,
      jobName: input.jobName,
      arch: input.arch,
      stepsPlan: input.stepsPlan,
      language: input.language,
      steps: input.steps,
      scms: toRequestScms(input.scms),
      parameters: input.parameters,
      description: input.description,
      flavor,
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

    // ⑥.5 空 scms 附加提示（FE-09 P2-C：任务无代码源，run_job 可能无仓库可构建）
    let hint = '';
    if (!input.scms || input.scms.length === 0) {
      hint = input.agencyUrn
        ? '（注意：scms 为空 + agencyUrn——任务无代码源，后续 run_job 可能无仓库可构建；如需代码源请补 scms 或确认委托账号绑定仓库）'
        : '（注意：scms 为空——任务无代码源；如需基于仓库构建请补 scms（scm_type=codehub, repo_id 等，FE-08 §1.5））';
    }

    return makeSuccessResult({ job_id: jobId, created: true, ...(hint ? { scms_empty_hint: hint } : {}) }, `创建构建任务成功: jobId=${jobId}${hint}`);
  } catch (e) {
    // 422 仓库不存在 → 增强回溯提示（FE-07 §2.5 错误回流：强制回溯 scm 来源渠道，不继续换 scm_type 重试）
    if (e instanceof ToolException && e.code === 'E_PARAM') {
      const msg = `${e.message} ${e.details ?? ''}`;
      if (/仓库不存在|仓库已被删除|不存在或已被删除/i.test(msg) && input.scms?.length) {
        return makeErrorResult(
          'E_PARAM',
          `${e.message}\n提示: create_job.scms 引用的仓库不存在——请回溯 scm 来源渠道（① CodeArtsRepo 建仓返回 ② get_job/list_jobs 已有任务回读 ③ 本地远端解析），确认 repo_id 有效；禁止臆造 scm_type/repo_id 后重试（FE-07 §2.5）`,
          e.details,
        );
      }
    }
    return mapToolError(e, 'E_API');
  }
}
