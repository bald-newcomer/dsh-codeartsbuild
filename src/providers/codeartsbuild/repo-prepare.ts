/**
 * codeartsbuild_repo_prepare 工具 handler
 * 对齐 FE-08-本地远端仓库方案探索-20260923.md §5（独立工具决策）+ api-contract.md §2.17（repo_prepare 契约）
 *
 * 职责：本地 git 仓库 → CodeArtsRepo 仓库准备（2026-09-28 自 repo_push 瘦身改名）
 * ① 检测本地 git 仓库 + git remote -v（只读；已有 codehub 远端 → 返回已有信息，跳过建仓）
 * ② 无远端 → POST /v1/repositories { project_uuid, name }（service=codeartsrepo）创建空仓
 * ③ GET /v1/repositories/{repository_uuid} 回读 RepoInfo（repoId/httpUrl/sshUrl/webUrl）
 * ④ 返回 RepoInfo + remote_url + push_guidance（供 create_job.scms 映射 + 模型自行执行 git push）
 *
 * 不做 git push：实际推送由模型用宿主命令工具（bash/pwsh）自探索执行——认证/代理/网络等
 * 本地环境差异由模型读 stderr 自行分类决策（见 repo_prepare.md「推送链路契约」）。
 *
 * 承载：HttpClient service:'codeartsrepo'（FE-06 §3.2 多服务适配，实测确认 AK/SK 签名可用）
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

/** ListRepositoryByProject 响应（per-project，2026-09-29 实测确认：字段名为 result.repositorys（拼写缺 i），项为 camelCase）
 *  - 列表字段：repositorys（注意拼写，非 repositories）
 *  - 项字段：id（仓库 UUID）/ repoId / name / projectId（camelCase）
 */
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
 * - HTTPS 格式：https://codehub.../{projectUuid}/{repoName}.git（路径第 4 段）
 * - SSH 格式：git@codehub...:{projectUuid}/{repoName}.git（冒号后第 1 段）
 * 返回 null 表示 URL 格式不可识别（非 codehub 标准格式），不做比对
 */
function parseProjectUuidFromRemoteUrl(remoteUrl: string): string | null {
  const httpsMatch = remoteUrl.match(/\/([a-f0-9]{32})\/[^/]+\.git$/);
  if (httpsMatch) return httpsMatch[1];
  const sshMatch = remoteUrl.match(/:([a-f0-9]{32})\/[^/]+\.git$/);
  if (sshMatch) return sshMatch[1];
  return null;
}

/**
 * 构造 project_mismatch 警告字段（远端 URL 项目归属 ≠ 入参 projectUuid 时附加）
 * 让模型/用户在结果中直接看到不一致，避免在错误项目建仓/推送后才发现
 */
function buildMismatchWarning(remoteProjectUuid: string, inputProjectUuid: string, scenario: 'created' | 'existing'): Record<string, unknown> | null {
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

/**
 * 在指定项目创建空仓并轮询回读 RepoInfo（2026-09-29 复用：已有远端但目标项目无此仓库 → 建仓）
 * 实测确认：请求体 snake_case { project_uuid, name }；建仓后 git 端异步初始化（约 1s），
 * GetRepository 期间 404（CH.000404）视为未初始化，轮询等待（最长 10s）
 */
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
      if (repo.repoId && repo.sshUrl) break;
    } catch (e) {
      const detailStr = e instanceof ToolException ? JSON.stringify(e.details ?? {}) : String(e);
      if (!(e instanceof ToolException && e.code === 'E_PARAM' && /CH\.000404|仓库不存在/.test(detailStr))) {
        throw e;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const repoId = repo.repoId ?? null;
  const sshUrl = repo.sshUrl ?? null;
  const httpUrl = repo.httpUrl ?? null;
  const webUrl = repo.webUrl ?? null;
  if (!repoId || !sshUrl) {
    throw new ToolException('E_API', 'GetRepository 响应缺 repoId/sshUrl（建仓后 10s 内 git 端未初始化）', { repository_uuid: repositoryUuid });
  }
  return {
    repositoryUuid,
    repoId,
    sshUrl,
    httpUrl: httpUrl ?? '',
    webUrl: webUrl ?? '',
    resolvedName: repo.name ?? repoName,
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

    // ② 检测本地 git 仓库 + 已有远端（只读）
    let existingRemote = '';
    try {
      const remotes = await runGitReadonly(input.repoPath, ['remote', '-v']);
      // 提取第一个 origin/https/ssh 远端地址
      const originLine = remotes.stdout.split('\n').find((l) => l.includes('codehub'));
      existingRemote = originLine?.split(/\s+/)[1] ?? '';
    } catch {
      // 不是 git 仓库：由后续 create 逻辑走建仓（新仓库无需 remote -v）
    }

    // ③ 已有 codehub 远端 → 在**目标项目**内按名查仓库（2026-09-29 用户决策：per-project 查询，不跨项目找）
    // 命中 → 回读 repo_id 返回已有信息；未命中（当前项目无此仓库）→ **在当前项目建仓**（允许新建，不去其他项目找）
    if (existingRemote && (existingRemote.includes('codehub') || existingRemote.includes('devcloud'))) {
      // 3.0 从远端 URL 解析仓库名 + 项目 UUID（项目 UUID 用于机制层比对，FE-09 R3 2026-09-29）
      const sshMatch = existingRemote.match(/([^\/:]+)\.git$/);
      const remoteRepoName = sshMatch?.[1] ?? '';
      const remoteProjectUuid = parseProjectUuidFromRemoteUrl(existingRemote);
      // 机制层 project_mismatch 检测：远端 URL 项目归属 ≠ 入参 projectUuid 时附警告（场景随分支不同）
      // 3.2 per-project 按名查：GET /v1/projects/{input.projectUuid}/repositories（uuid=入参目标项目）
      let resolvedRepoId: string | null = null;
      let resolvedRepoUuid: string | null = null;
      let resolvedRepoUrl = existingRemote;
      if (remoteRepoName) {
        try {
          const listResp = await ctx.client.call<ListRepositoryByProjectResponse>(
            {
              method: 'GET',
              path: `/v1/projects/${input.projectUuid}/repositories`,
              query: { page_no: 1, page_size: 100 },
              service: 'codeartsrepo',
            },
            { idempotent: true },
          );
          // 2026-09-29 实测：per-project 响应字段为 result.repositorys（拼写缺 i），项 camelCase（id/name/projectId）
          const list: Array<Record<string, unknown>> = listResp.result?.repositorys ?? listResp.result?.repositories ?? [];
          let hitUuid: string | null = null;
          for (const r of list) {
            const itemName = (r.name ?? r.repository_name) as string | undefined;
            const itemUuid = (r.id ?? r.repository_uuid) as string | undefined;
            if (itemName === remoteRepoName && itemUuid) {
              hitUuid = itemUuid;
              break;
            }
          }
          if (hitUuid) {
            resolvedRepoUuid = hitUuid;
            const repoResp = await ctx.client.call<GetRepositoryResponse>(
              {
                method: 'GET',
                path: `/v1/repositories/${resolvedRepoUuid}`,
                query: {},
                service: 'codeartsrepo',
              },
              { idempotent: true },
            );
            resolvedRepoId = repoResp.result?.repoId ?? null;
            resolvedRepoUrl = repoResp.result?.httpUrl ?? existingRemote;
          }
        } catch {
          // 查询失败不阻断——维持 repo_id:null，由模型转人工/其他渠道
        }
      }
      // 3.3 未命中（当前项目无此仓库）→ 在当前项目建仓（2026-09-29 用户决策：允许新建）
      if (!resolvedRepoId) {
        const created = await createRepoInProject(ctx, input.projectUuid, repoName);
        resolvedRepoId = created.repoId;
        resolvedRepoUuid = created.repositoryUuid;
        resolvedRepoUrl = created.httpUrl;
        const base: Record<string, unknown> = {
          repository_uuid: created.repositoryUuid,
          repo_id: created.repoId,
          repo_name: created.resolvedName,
          url: created.httpUrl,
          web_url: created.webUrl,
          ssh_url: created.sshUrl,
          branch,
          remote_url: created.httpUrl,
          push_guidance: `git remote add origin ${created.httpUrl} && git push -u origin ${branch}`,
          created_in_target_project: true,
        };
        let mismatchMsg = '';
        const mismatchFields =
          remoteProjectUuid && remoteProjectUuid !== input.projectUuid
            ? buildMismatchWarning(remoteProjectUuid, input.projectUuid, 'created')
            : null;
        if (mismatchFields) {
          Object.assign(base, mismatchFields);
          mismatchMsg = `（⚠️ project_mismatch：${mismatchFields.mismatch_hint}）`;
        }
        const scmHint = `create_job.scms 可用: { scm_type: "codehub", repo_id: "${created.repoId}", repo_name: "${created.resolvedName}", url: "${created.httpUrl}", web_url: "${created.webUrl}" }`;
        return makeSuccessResult(
          base,
          `本地仓库已有远端 ${existingRemote}，但目标项目（${input.projectUuid}）中无同名仓库——已在当前项目新建 ${repoName}（repo_id=${created.repoId}）。${scmHint}。远端已变更为新仓库地址，请对新地址执行 git push（${base.push_guidance}）。${mismatchMsg}`.trim(),
        );
      }
      // 3.4 命中 → 返回已有仓库信息
      const base: Record<string, unknown> = {
        repository_uuid: resolvedRepoUuid,
        repo_id: resolvedRepoId,
        repo_name: repoName,
        url: resolvedRepoUrl,
        web_url: resolvedRepoUrl,
        ssh_url: existingRemote,
        branch,
        existing_remote: true,
      };
      let mismatchMsg = '';
      const mismatchFields =
        remoteProjectUuid && remoteProjectUuid !== input.projectUuid
          ? buildMismatchWarning(remoteProjectUuid, input.projectUuid, 'existing')
          : null;
      if (mismatchFields) {
        Object.assign(base, mismatchFields);
        mismatchMsg = `（⚠️ project_mismatch：${mismatchFields.mismatch_hint}）`;
      }
      const scmHint = `create_job.scms 可用: { scm_type: "codehub", repo_id: "${resolvedRepoId}", repo_name: "${repoName}", url: "${resolvedRepoUrl}" }`;
      return makeSuccessResult(
        base,
        `仓库 ${repoName} 已在目标项目（${input.projectUuid}）中存在（远端 ${existingRemote}）。${scmHint}。如需推送代码，请对现有远端执行 git push（失败时读 stderr 判断认证/网络问题并处理）。${mismatchMsg}`.trim(),
      );
    }

    // ④ 无远端 → 创建空仓并轮询回读 RepoInfo（POST /v1/repositories + GET /v1/repositories/{uuid}）
    const created = await createRepoInProject(ctx, input.projectUuid, repoName);

    // ⑤ 返回 RepoInfo + remote_url + push_guidance（供 create_job.scms 映射 + 模型自行 push）
    const base = {
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
    const scmHint = `create_job.scms 可用: { scm_type: "codehub", repo_id: "${created.repoId}", repo_name: "${created.resolvedName}", url: "${created.httpUrl}", web_url: "${created.webUrl}" }`;
    return makeSuccessResult(
      base,
      `仓库 ${repoName} 已创建于 CodeArtsRepo（repo_id=${created.repoId}）。${scmHint}。推送代码请执行: ${base.push_guidance}（push 由你执行，失败时读 stderr 判断认证/网络问题并处理；或提示用户配置访问令牌/SSH 密钥后重试）`,
    );
  } catch (e) {
    return mapToolError(e, 'E_API');
  }
}
