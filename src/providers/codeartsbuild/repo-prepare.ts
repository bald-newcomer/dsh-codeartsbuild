/**
 * codeartsbuild_repo_prepare 工具 handler
 * 对齐 FE-08-本地远端仓库方案探索-20260923.md §5 + api-contract.md §2.17
 *
 * 流程：检测本地 git 远端（只读）→ 已有 codehub 远端按名查目标项目仓库
 *       → 命中回读 repo_id / 未命中建仓 → 返回 RepoInfo + remote_url + push_guidance
 * 不做 git push：实际推送由模型用宿主命令工具执行（认证/代理等本地差异读 stderr 自决）
 * 承载：HttpClient service:'codeartsrepo'（FE-06 §3.2 多服务适配，实测 AK/SK 签名可用）
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

const execFileAsync = promisify(execFile);

/** 工具入参 */
export interface RepoPrepareHandlerInput {
  /** 本地仓库绝对路径 */
  repoPath: string;
  /** 目标项目 UUID（32 位小写数字字母，建仓必填——CodeArtsRepo 要求 project_uuid） */
  projectUuid: string;
  /** 仓库名（默认取目录名） */
  repoName?: string;
  /** 分支（默认 master） */
  branch?: string;
}

/** CreateRepository 响应（service=codeartsrepo，实测确认） */
interface CreateRepositoryResponse {
  result?: { repository_uuid?: string };
  status?: string;
}

/** GetRepository 响应（RepoInfo，实测确认 camelCase） */
interface GetRepositoryResponse {
  result?: {
    id?: string;
    repoId?: string;
    name?: string;
    sshUrl?: string;
    httpUrl?: string;
    webUrl?: string;
    groupName?: string;
    projectId?: string;
  };
  status?: string;
}

/** ListRepositoryByProject 响应（2026-09-29 实测确认：列表字段 result.repositorys（拼写缺 i），项为 camelCase） */
interface ListRepositoryByProjectResponse {
  result?: {
    total?: number;
    repositorys?: Array<{
      id?: string;
      repoId?: string;
      name?: string;
      projectId?: string;
    }>;
    repositories?: Array<{
      repository_uuid?: string;
      repository_id?: number;
      repository_name?: string;
      project_uuid?: string;
    }>;
  };
  status?: string;
}

/** 目标项目内按名查到的仓库信息 */
interface RepoLookup {
  uuid: string;
  repoId: string | null;
  url: string | null;
}

/** 异步 git 只读执行辅助（repo_prepare 仅用只读命令；push 由模型执行） */
async function runGitReadonly(repoPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd: repoPath, timeout: 30_000 });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    throw new ToolException(
      'E_API',
      `git ${args[0]} 失败: ${err.stderr?.trim() || err.message || '未知错误'}`,
      { stdout: err.stdout?.trim(), args },
    );
  }
}

/**
 * 从 codehub 远端 URL 解析项目 UUID（FE-09 R3 机制层兜底，2026-09-29）
 * - HTTPS：https://codehub.../{projectUuid}/{repoName}.git（路径第 4 段）
 * - SSH：git@codehub...:{projectUuid}/{repoName}.git（冒号后第 1 段）
 * 返回 null 表示 URL 格式不可识别，不做比对
 * @export 供 create_job 的 scms URL 项目一致性校验复用（2026-10-10，防复制漂移）
 */
export function parseProjectUuidFromRemoteUrl(remoteUrl: string): string | null {
  const httpsMatch = remoteUrl.match(/\/([a-f0-9]{32})\/[^/]+\.git$/);
  if (httpsMatch) return httpsMatch[1];
  const sshMatch = remoteUrl.match(/:([a-f0-9]{32})\/[^/]+\.git$/);
  if (sshMatch) return sshMatch[1];
  return null;
}

/** 远端 URL 项目归属 ≠ 入参 projectUuid 时附加的警告字段（避免在错误项目建仓/推送后才发现） */
function buildMismatchWarning(remoteProjectUuid: string, inputProjectUuid: string, scenario: 'created' | 'existing'): Record<string, unknown> {
  const hint =
    scenario === 'created'
      ? `远端 URL 指向项目 ${remoteProjectUuid}，与入参 projectUuid（${inputProjectUuid}）不一致——已在入参项目新建仓库；须对新仓库地址执行 git push，不要对旧远端推送（旧远端属另一项目）`
      : `远端 URL 指向项目 ${remoteProjectUuid}，与入参 projectUuid（${inputProjectUuid}）不一致——命中的是入参项目中的同名仓库，与远端 URL 所属项目不同；请确认是否同一仓库，或改用远端 URL 所属项目（${remoteProjectUuid}）作为 projectUuid`;
  return {
    project_mismatch: true,
    remote_project_uuid: remoteProjectUuid,
    mismatch_hint: hint,
  };
}

/** 追加 project_mismatch 警告字段，返回消息后缀（一致或无法解析时不追加） */
function applyMismatchWarning(
  base: Record<string, unknown>,
  remoteProjectUuid: string | null,
  inputProjectUuid: string,
  scenario: 'created' | 'existing',
): string {
  if (!remoteProjectUuid || remoteProjectUuid === inputProjectUuid) return '';
  const fields = buildMismatchWarning(remoteProjectUuid, inputProjectUuid, scenario);
  Object.assign(base, fields);
  return `（⚠️ project_mismatch：${fields.mismatch_hint}）`;
}

/** create_job.scms 可用映射提示 */
function buildScmHint(repoId: string, repoName: string, url: string, webUrl?: string): string {
  const web = webUrl ? `, web_url: "${webUrl}"` : '';
  return `create_job.scms 可用: { scm_type: "codehub", repo_id: "${repoId}", repo_name: "${repoName}", url: "${url}"${web} }`;
}

/** 检测本地 git 仓库已有 codehub 远端地址（只读；非 git 仓库/无远端返回空串） */
async function detectRemote(repoPath: string): Promise<string> {
  try {
    const remotes = await runGitReadonly(repoPath, ['remote', '-v']);
    // 提取第一个含 codehub 的远端地址
    return remotes.stdout.split('\n').find((l) => l.includes('codehub'))?.split(/\s+/)[1] ?? '';
  } catch {
    return ''; // 非 git 仓库：走建仓（新仓库无需 remote -v）
  }
}

/** 在目标项目按名查仓库并回读 repo_id（实测：列表字段 repositorys 缺 i，项 camelCase；查询失败返回 null 不阻断） */
async function lookupRepoInProject(ctx: CloudToolContext, projectUuid: string, repoName: string): Promise<RepoLookup | null> {
  try {
    const listResp = await ctx.client.call<ListRepositoryByProjectResponse>(
      {
        method: 'GET',
        path: `/v1/projects/${projectUuid}/repositories`,
        query: { page_no: 1, page_size: 100 },
        service: 'codeartsrepo',
      },
      { idempotent: true },
    );
    const list: Array<Record<string, unknown>> = listResp.result?.repositorys ?? listResp.result?.repositories ?? [];
    const hit = list.find((r) => (r.name ?? r.repository_name) === repoName && (r.id ?? r.repository_uuid));
    if (!hit) return null;
    const uuid = (hit.id ?? hit.repository_uuid) as string;
    const repoResp = await ctx.client.call<GetRepositoryResponse>(
      {
        method: 'GET',
        path: `/v1/repositories/${uuid}`,
        query: {},
        service: 'codeartsrepo',
      },
      { idempotent: true },
    );
    return { uuid, repoId: repoResp.result?.repoId ?? null, url: repoResp.result?.httpUrl ?? null };
  } catch {
    return null; // 查询失败不阻断——维持 repo_id:null，由建仓/人工兜底
  }
}

/** 建仓（POST /v1/repositories）+ 轮询回读 RepoInfo（实测：建仓后 git 端异步初始化约 1s，GetRepository 期间 CH.000404 视为未初始化，最长等 10s） */
async function createRepoInProject(
  ctx: CloudToolContext,
  projectUuid: string,
  repoName: string,
): Promise<{ repositoryUuid: string; repoId: string; sshUrl: string; httpUrl: string; webUrl: string; resolvedName: string }> {
  const createResp = await ctx.client.call<CreateRepositoryResponse>(
    {
      method: 'POST',
      path: '/v1/repositories',
      body: { project_uuid: projectUuid, name: repoName },
      service: 'codeartsrepo',
    },
    { idempotent: false },
  );
  const repositoryUuid = createResp.result?.repository_uuid;
  if (!repositoryUuid) {
    throw new ToolException('E_API', 'CreateRepository 成功但响应缺 result.repository_uuid', createResp);
  }
  const repo = await pollRepositoryInfo(ctx, repositoryUuid);
  const { repoId, sshUrl, httpUrl, webUrl, name } = repo;
  if (!repoId || !sshUrl) {
    throw new ToolException('E_API', 'GetRepository 响应缺 repoId/sshUrl（建仓后 10s 内 git 端未初始化）', { repository_uuid: repositoryUuid });
  }
  return {
    repositoryUuid,
    repoId,
    sshUrl,
    httpUrl: httpUrl ?? '',
    webUrl: webUrl ?? '',
    resolvedName: name ?? repoName,
  };
}

/** 建仓后 GetRepository 轮询（每 1s 一次，最长 10 次；404 未初始化视为正常等待，其余错误抛出） */
async function pollRepositoryInfo(
  ctx: CloudToolContext,
  repositoryUuid: string,
): Promise<NonNullable<GetRepositoryResponse['result']>> {
  let repo: GetRepositoryResponse['result'] = {};
  for (let i = 0; i < 10; i++) {
    try {
      const repoResp = await ctx.client.call<GetRepositoryResponse>(
        {
          method: 'GET',
          path: `/v1/repositories/${repositoryUuid}`,
          query: {},
          service: 'codeartsrepo',
        },
        { idempotent: true },
      );
      repo = repoResp.result ?? {};
      if (repo.repoId && repo.sshUrl) return repo;
    } catch (e) {
      if (!isInitPending404(e)) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return repo;
}

/** 判断错误是否为"仓库未初始化"（CH.000404/仓库不存在 → 建仓后等待，不视为失败） */
function isInitPending404(e: unknown): boolean {
  const detailStr = e instanceof ToolException ? JSON.stringify(e.details ?? {}) : String(e);
  return e instanceof ToolException && e.code === 'E_PARAM' && /CH\.000404|仓库不存在/.test(detailStr);
}

/** 建仓成功的基础返回字段（含 remote_url + push_guidance，供 create_job.scms 映射 + 模型自行 push） */
function buildCreatedBase(
  created: { repositoryUuid: string; repoId: string; sshUrl: string; httpUrl: string; webUrl: string; resolvedName: string },
  branch: string,
): Record<string, unknown> {
  return {
    repository_uuid: created.repositoryUuid,
    repo_id: created.repoId,
    repo_name: created.resolvedName,
    url: created.httpUrl,
    web_url: created.webUrl,
    ssh_url: created.sshUrl,
    branch,
    remote_url: created.httpUrl,
    push_guidance: `git remote add origin ${created.httpUrl} && git push -u origin ${branch}`,
  };
}

/** 已有远端命中时的基础返回字段（url 回读失败回落远端地址） */
function buildExistingBase(
  found: RepoLookup,
  repoName: string,
  existingRemote: string,
  branch: string,
): Record<string, unknown> {
  return {
    repository_uuid: found.uuid,
    repo_id: found.repoId,
    repo_name: repoName,
    url: found.url ?? existingRemote,
    web_url: found.url ?? existingRemote,
    ssh_url: existingRemote,
    branch,
    existing_remote: true,
  };
}

/**
 * repo_prepare 工具 handler：本地仓库 → CodeArtsRepo 仓库准备（建仓 + RepoInfo，不做 push）
 */
export async function repoPrepareHandler(
  ctx: CloudToolContext,
  input: RepoPrepareHandlerInput,
): Promise<ToolResult> {
  try {
    // ① 校验入参
    if (!input.repoPath) {
      throw new ToolException('E_PARAM', 'repoPath 必填', '本地 git 仓库绝对路径');
    }
    if (!input.projectUuid || !/^[a-z0-9]{32}$/.test(input.projectUuid)) {
      throw new ToolException(
        'E_PARAM',
        `projectUuid 非法（32 位小写数字字母），实际: ${input.projectUuid ?? ''}`,
        'CodeArtsRepo 建仓要求 project_uuid 为 32 位小写 UUID（来自 list_projects 的 identifier）',
      );
    }
    const branch = input.branch ?? 'master';
    const repoName = input.repoName ?? input.repoPath.split(/[\\/]/).filter(Boolean).pop() ?? 'repo';

    // ② 检测已有远端（只读）
    const existingRemote = await detectRemote(input.repoPath);

    // ③ 已有 codehub 远端 → 按名查目标项目仓库（FE-09 R3：远端 URL 解析仓库名 + 项目 UUID 做机制层比对）
    if (existingRemote && (existingRemote.includes('codehub') || existingRemote.includes('devcloud'))) {
      const remoteRepoName = existingRemote.match(/([^\/:]+)\.git$/)?.[1] ?? '';
      const remoteProjectUuid = parseProjectUuidFromRemoteUrl(existingRemote);
      const found = remoteRepoName ? await lookupRepoInProject(ctx, input.projectUuid, remoteRepoName) : null;

      // 3.3 未命中（当前项目无此仓库）→ 在当前项目建仓（2026-09-29 决策：允许新建）
      if (!found?.repoId) {
        const created = await createRepoInProject(ctx, input.projectUuid, repoName);
        const base = buildCreatedBase(created, branch);
        base.created_in_target_project = true;
        const mismatchMsg = applyMismatchWarning(base, remoteProjectUuid, input.projectUuid, 'created');
        const scmHint = buildScmHint(created.repoId, created.resolvedName, created.httpUrl, created.webUrl);
        return makeSuccessResult(
          base,
          `本地仓库已有远端 ${existingRemote}，但目标项目（${input.projectUuid}）中无同名仓库——已在当前项目新建 ${repoName}（repo_id=${created.repoId}）。${scmHint}。远端已变更为新仓库地址，请对新地址执行 git push（${base.push_guidance}）。${mismatchMsg}`.trim(),
        );
      }

      // 3.4 命中 → 返回已有仓库信息
      const base = buildExistingBase(found, repoName, existingRemote, branch);
      const mismatchMsg = applyMismatchWarning(base, remoteProjectUuid, input.projectUuid, 'existing');
      const scmHint = buildScmHint(found.repoId, repoName, found.url ?? existingRemote);
      return makeSuccessResult(
        base,
        `仓库 ${repoName} 已在目标项目（${input.projectUuid}）中存在（远端 ${existingRemote}）。${scmHint}。如需推送代码，请对现有远端执行 git push（失败时读 stderr 判断认证/网络问题并处理）。${mismatchMsg}`.trim(),
      );
    }

    // ④ 无远端 → 创建空仓并轮询回读 RepoInfo
    const created = await createRepoInProject(ctx, input.projectUuid, repoName);
    const base = buildCreatedBase(created, branch);
    const scmHint = buildScmHint(created.repoId, created.resolvedName, created.httpUrl, created.webUrl);
    return makeSuccessResult(
      base,
      `仓库 ${repoName} 已创建于 CodeArtsRepo（repo_id=${created.repoId}）。${scmHint}。推送代码参考执行命令: ${base.push_guidance}（push 由你执行，失败时读 stderr 判断认证/网络问题并处理；或提示用户配置访问令牌/SSH 密钥后重试）`,
    );
  } catch (e) {
    return mapToolError(e, 'E_API');
  }
}
