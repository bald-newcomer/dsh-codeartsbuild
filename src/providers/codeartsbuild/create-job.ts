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
import { assembleConfig, listAvailableTemplates, resolveStep } from './template-assembler.js';
import { parseProjectUuidFromRemoteUrl } from './repo-prepare.js';
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
  /**
   * image 字面量来源标记（FE-16 §2.2 软引导，2026-11-03 会话 e3c9f738）
   * - 'list_templates'/'get_job'：从工具返回值取（正常路径）
   * - 'default'：用模板默认 image（省略 properties.image）
   * - 'manual'：模型凭记忆传（降级路径）
   * 未传 + steps 中存在 properties.image 覆盖 → image_source_unverified 警告（不阻断，附 next_actions 引导先 list_templates）
   */
  imageSource?: 'list_templates' | 'get_job' | 'default' | 'manual';
}

/**
 * 业务校验：jobName 长度 + 字符集 + flavor 枚举（schemastery 已拦必填/类型，此处补业务校验）
 * 2026-09-29：jobName 支持中英文/数字/下划线/连字符，≤115；flavor 仅 DEFAULT 合法
 * @returns 解析后的 flavor（缺省 DEFAULT）
 */
function validateJobBasics(input: Pick<CreateJobHandlerInput, 'jobName' | 'flavor'>): string {
  const { jobName, flavor } = input;
  if (!jobName || jobName.length > 115) {
    throw new ToolException('E_PARAM', `jobName 长度非法（1~115），实际: ${jobName?.length ?? 0}`);
  }
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]+$/.test(jobName)) {
    throw new ToolException(
      'E_PARAM',
      `jobName 字符集非法: "${jobName}"——仅支持中英文、数字、下划线 _、连字符 -（长度 1~115）`,
    );
  }
  // ①.5 flavor 校验：仅 DEFAULT 合法（2026-09-29 用户确认：目前只有 DEFAULT 合法，1cpu4g/2u8g 非当前枚举）
  const FLAVORS = ['DEFAULT'] as const;
  const resolvedFlavor = flavor ?? 'DEFAULT';
  if (!FLAVORS.includes(resolvedFlavor as (typeof FLAVORS)[number])) {
    throw new ToolException('E_PARAM', `flavor 非法: "${resolvedFlavor}"——当前仅支持 DEFAULT（缺省即 DEFAULT）`);
  }
  return resolvedFlavor;
}

/** 空 scms 附加提示（FE-09 P2-C：任务无代码源，run_job 可能无仓库可构建；FE-13 §2.3：提示升级为操作路径引导） */
function buildScmsEmptyHint(input: CreateJobHandlerInput): string {
  if (input.scms && input.scms.length > 0) return '';
  const pathGuidance =
    '正确顺序为先 repo_prepare(建仓取 remote_url/repo_id) → repo_push(推代码) → 再 create_job 带 scms；对已建任务可用 update_job 补 scms（scm_type=codehub, repo_id 来自 repo_prepare 输出）。';
  return input.agencyUrn
    ? `（注意：scms 为空 + agencyUrn——任务无代码源，后续 run_job 可能无仓库可构建；agencyUrn 须用户显式提供（模型不得自行填写绕过 scm 链路）；如需代码源请补 scms 或确认委托账号绑定仓库。${pathGuidance}）`
    : `（注意：scms 为空——任务无代码源，run_job 可能无仓库可构建；若意图是"基于仓库构建"，${pathGuidance}）`;
}

/**
 * stepsPlan 前置校验（2026-10-10：模型曾臆造裸 module_id 致 create_job 首败）
 * 在拼装请求体前直接 resolveStep，未匹配即抛 E_PARAM 附 template_id 清单，
 * 引导模型用 template_id 而非裸 module_id（module_id 仅高级 steps 数组全限定名用）。
 */
function validateStepsPlanRefs(stepsPlan?: CreateJobHandlerInput['stepsPlan']): void {
  if (!stepsPlan || stepsPlan.length === 0) return;
  for (const [i, plan] of stepsPlan.entries()) {
    if (!plan.step || !plan.step.trim()) {
      throw new ToolException('E_PARAM', `stepsPlan[${i}].step 为空`, 'stepsPlan[].step 必填：template_id（推荐）或全限定 module_id');
    }
    try {
      // 未匹配即抛（resolveStep 内部列可用模板）
      resolveStep(plan.step);
    } catch (e) {
      if (e instanceof ToolException && e.code === 'E_PARAM') {
        const templateIds = listAvailableTemplates().map((t) => t.template_id).join(', ');
        throw new ToolException(
          'E_PARAM',
          `stepsPlan[${i}].step="${plan.step}" 未匹配模板（${e.message}）`,
          `应使用 template_id（可用: ${templateIds}）；module_id 仅用于 steps 数组的全限定名（如 devcloud2018.codeci_action_20043.action），stepsPlan 请用 template_id 重试`,
        );
      }
      throw e;
    }
  }
}

/**
 * groupId 臆造防御（2026-10-10：模型曾臆造 dsh-quant-group 致 create_job 422 分组不存在）
 * 非空 groupId 必须来自 get_job 回读的已有分组或用户显式确认；否则 E_PARAM 提示来源。
 */
function validateGroupId(groupId?: string): void {
  if (!groupId || !groupId.trim()) return;
  // 最小实现：非空即要求来源可证——本工具不自拉分组列表（拉取归 get_job 待办 #10 范畴）
  throw new ToolException(
    'E_PARAM',
    `groupId="${groupId}" 臆造风险——非空 groupId 必须来自 get_job 回读的已有分组或用户显式确认，禁止臆造（曾触发 422 分组不存在）`,
    '请经 get_job 回读已有任务的分组（groupId 字段），或向用户确认分组名后重试；无需分组时请省略该字段',
  );
}

/** 422 仓库不存在 → 增强回溯提示（FE-07 §2.5 错误回流：强制回溯 scm 来源渠道，不继续换 scm_type 重试） */
function enhanceScmTracebackError(e: ToolException, input: CreateJobHandlerInput): ToolResult | null {
  const msg = `${e.message} ${e.details ?? ''}`;
  if (/仓库不存在|仓库已被删除|不存在或已被删除/i.test(msg) && input.scms?.length) {
    return makeErrorResult(
      'E_PARAM',
      `${e.message}\n提示: create_job.scms 引用的仓库不存在——请回溯 scm 来源渠道（① CodeArtsRepo 建仓返回 ② get_job/list_jobs 已有任务回读 ③ 本地远端解析），确认 repo_id 有效；禁止臆造 scm_type/repo_id 后重试（FE-07 §2.5）`,
      e.details,
    );
  }
  return null;
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

/**
 * scms URL 项目一致性校验（2026-10-10：本次会话 origin 跨项目 + create_job 跨项目臆造致建错仓）
 * scms[].url 解析出的项目 UUID ≠ 会话 projectId → E_PARAM 提示项目不一致（禁止跨项目建仓/建任务）。
 * URL 不可解析（非 codehub 格式）→ 放行不阻断。
 */
function validateScmProjectConsistency(scms: ScmInfo[] | undefined, projectId: string): void {
  if (!scms || scms.length === 0) return;
  for (const scm of scms) {
    const raw = scm as unknown as Record<string, unknown>;
    const url = (raw.url ?? '') as string;
    if (!url) continue;
    const remoteUuid = parseProjectUuidFromRemoteUrl(url);
    if (remoteUuid && remoteUuid !== projectId) {
      throw new ToolException(
        'E_PARAM',
        `create_job.scms[].url="${url}" 指向项目 ${remoteUuid}，与会话/入参 projectId（${projectId}）不一致`,
        '禁止跨项目建仓/建任务。请将 projectId 切换为 remote_uuid（${remoteUuid}）并经用户显式确认刷新会话，或改用同一项目内的仓库地址（scm 字段取自 repo_prepare 建仓返回 / get_job 回读）',
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

/** ListJob 查重响应（仅取 job 名是否已存在） */
interface ListJobForDupResponse {
  result?: {
    total?: number;
    job_list?: Array<Record<string, unknown>>;
  };
}

/**
 * 任务名查重（FE-15 §4 #10 机制化，2026-10-23 会话 63534983）
 * 会话证据：SKILL 规约 #10 要求 create_job 前 list_jobs(search=jobName) 查重，
 * 但模型跳过查重、删旧建新绕过。此处工具内自查——
 * GET /v1/job/list?search=<jobName>，命中同名任务 → E_PARAM 引导复用/改名/update_job，不重复新建。
 * 查重失败（网络/接口错误）→ 不阻断（返回 false，让服务端 422 兜底）。
 */
async function checkJobNameDuplicate(ctx: CreateJobToolContext, jobName: string): Promise<boolean> {
  try {
    const resp = await ctx.client.call<ListJobForDupResponse>(
      { method: 'GET', path: '/v1/job/list', query: { search: jobName, page_size: 20 } },
      { idempotent: true },
    );
    const jobs = resp.result?.job_list ?? [];
    return jobs.length > 0;
  } catch {
    return false; // 查重失败不阻断（服务端 422 兜底）
  }
}

/**
 * create_job 工具 handler
 */
export async function createJobHandler(
  ctx: CreateJobToolContext,
  input: CreateJobHandlerInput,
): Promise<ToolResult> {
  try {
    // ① 业务校验：jobName 长度 + 字符集 + flavor 枚举（返回解析后 flavor）
    const flavor = validateJobBasics(input);
    // ② projectId 会话注入
    const projectId = resolveProjectId(input.projectId, ctx.session, ctx.envProjectId);

    // ②.2 任务名查重（FE-15 §4 #10：命中同名 → 引导复用/改名/update_job，不重复新建）
    const dupExists = await checkJobNameDuplicate(ctx, input.jobName);
    if (dupExists) {
      throw new ToolException(
        'E_PARAM',
        `项目下已存在同名构建任务 "${input.jobName}"（list_jobs 查重命中）`,
        `请选择：① 用 update_job 修改已有任务（先 get_job 取原配置）；② 改名创建（加 -v2 等后缀）；③ 经用户确认后删除重建（delete_job 须 confirm=true）。禁止重复新建同名任务（服务端会返回 422 DEVCB.00031075）`,
      );
    }

    // ②.25 stepsPlan 前置校验（2026-10-10：拦截臆造裸 module_id，引导用 template_id）
    validateStepsPlanRefs(input.stepsPlan);
    // ②.5 groupId 臆造防御（2026-10-10：曾臆造分组致 422）
    validateGroupId(input.groupId);
    // ②.5 scm 字段来源校验（FE-07 §2.5 O5：禁止臆造 scm_type/repo_id/第三方 URL）
    validateScms(input.scms);
    // ②.75 scms URL 项目一致性校验（2026-10-10：禁止跨项目）
    validateScmProjectConsistency(input.scms, projectId);

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

    // ④.5 image 字面量来源软引导（FE-16 §2.2，2026-11-03 会话 e3c9f738）：
    // steps 中存在 properties.image 覆盖（非默认值）且未传 imageSource → 返回 image_source_unverified 警告（不创建）
    // 会话证据：模型传 image: "shell4.2.46-git1.8.3-zip6.00" 虽合法但未从 list_templates/get_job 验证——本次恰好命中，下次可能臆造
    // 软引导：模型传 imageSource: 'manual' 显式降级即可继续（审计可追溯）
    if (!input.imageSource) {
      const hasImageOverride = (requestBody.steps ?? []).some(
        (step) => {
          const props = step.properties as Record<string, unknown> | undefined;
          return props?.image !== undefined && props?.image !== null && props?.image !== '';
        },
      );
      if (hasImageOverride) {
        return makeSuccessResult(
          {
            created: false,
            need_image_source: true,
            job_name: input.jobName,
            hint: 'steps 中存在 properties.image 覆盖但未传 imageSource——image 字面量须取自 list_templates/get_job 返回值（规约 #12：照抄 image_select 字面量，勿凭记忆臆造）',
            next_actions: [
              "携带 imageSource: 'list_templates'（已从 list_templates 取值）重试 create_job",
              "或携带 imageSource: 'get_job'（已从 get_job 回读）重试 create_job",
              "或携带 imageSource: 'default'（用模板默认 image，省略 properties.image）重试 create_job",
              "或携带 imageSource: 'manual'（确认凭记忆传值，降级路径）重试 create_job",
            ],
          },
          'create_job: 检测到 properties.image 覆盖但未传 imageSource——请声明 image 来源后重试',
        );
      }
    }

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
    const hint = buildScmsEmptyHint(input);

    return makeSuccessResult({ job_id: jobId, created: true, ...(hint ? { scms_empty_hint: hint } : {}) }, `创建构建任务成功: jobId=${jobId}${hint}`);
  } catch (e) {
    // 422 仓库不存在 → 增强回溯提示（FE-07 §2.5 错误回流：强制回溯 scm 来源渠道，不继续换 scm_type 重试）
    if (e instanceof ToolException && e.code === 'E_PARAM') {
      const enhanced = enhanceScmTracebackError(e, input);
      if (enhanced) return enhanced;
    }
    return mapToolError(e, 'E_API');
  }
}
