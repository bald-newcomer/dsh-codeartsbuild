/**
 * codeartsbuild_repo_push 工具 handler
 * 对齐 FE-08-本地远端仓库方案探索-20260923.md §5（形态 B：内置一次"智能尝试"）+ 契约 §2.18
 *
 * 职责：本地 git 仓库推送代码到 CodeArtsRepo（repo_prepare 建仓之后接续）。
 * 形态（2026-10-10 用户决策）：独立工具，内置一次智能尝试——
 *   - 自动携带内网三要素（代理 http.proxy + SSL http.sslVerify=false）推送
 *   - push 前 git remote -v 预检 origin 项目归属（≠ projectUuid → project_mismatch 不推送）
 *   - 失败按 stderr 分类（AUTH/SSL/NETWORK/REJECTED_FETCH_FIRST/RUNTIME_CRASH/UNKNOWN），
 *     SSL/NETWORK 携参自动重试一次，仍失败输出 error_type + next_actions 交模型/用户接管
 * 不代执行交互式凭据（GCM/访问令牌）——分类 AUTH 后交模型/用户（2026-09-23 实测 HTTPS 需 GCM 交互）。
 * 承载：git 客户端本地执行（spawn, shell），无需云侧 HTTP。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import { parseProjectUuidFromRemoteUrl } from './repo-prepare.js';

/** 工具入参 */
export interface RepoPushHandlerInput {
  /** 本地 git 仓库绝对路径 */
  repoPath: string;
  /** 目标项目 UUID（32 位小写数字字母，= 会话 projectId；push 前 origin 归属校验用） */
  projectUuid: string;
  /** 仓库名（默认取目录名，仅诊断提示用） */
  repoName?: string;
  /** 推送分支（默认 master） */
  branch?: string;
  /** 目标 codehub 远端地址（默认取 repo_prepare 输出 remote_url） */
  remoteUrl?: string;
  /** 内网代理（默认 proxycn2.huawei.com:8080，可被环境覆盖） */
  proxyUrl?: string;
  /** 是否关闭 SSL 校验（默认 false=内网自签名证书，git -c http.sslVerify=false） */
  sslVerify?: boolean;
}

/** spawn 执行 git（shell，捕获 stdout/stderr 尾部，超时 SIGKILL）——仿 local-build/build.ts runBuild */
function runGit(
  args: string[],
  repoPath: string,
  timeoutMs = 120_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: repoPath, shell: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new ToolException('E_TIMEOUT', `git ${args[0]} 超时（${Math.round(timeoutMs / 1000)}s）`, { args }));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
      if (stdout.length > 4096 * 2) stdout = stdout.slice(-4096 * 2);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
      if (stderr.length > 4096 * 2) stderr = stderr.slice(-4096 * 2);
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout: stdout.slice(-4096), stderr: stderr.slice(-4096) });
    });
  });
}

/** push 失败分类（stderr 正则，对齐 git-push.md 决策树；RUNTIME_CRASH = 非零退出 + 空/畸态 stderr） */
export type PushErrorType =
  | 'AUTH'
  | 'SSL'
  | 'NETWORK'
  | 'REJECTED_FETCH_FIRST'
  | 'RUNTIME_CRASH'
  | 'UNKNOWN';

interface PushErrorClassifier {
  type: PushErrorType;
  pattern: RegExp;
}

const PUSH_ERROR_CLASSIFIERS: PushErrorClassifier[] = [
  { type: 'AUTH', pattern: /Authentication failed|Permission denied|access denied|401|could not read Username/i },
  { type: 'SSL', pattern: /self-signed certificate|SSL certificate|sslVerify|certificate chain/i },
  { type: 'NETWORK', pattern: /Connection timed out|Could not resolve host|Failed to connect|Name or service not known/i },
  { type: 'REJECTED_FETCH_FIRST', pattern: /rejected.*fetch first|failed to push some refs|non-fast-forward/i },
  { type: 'RUNTIME_CRASH', pattern: /CreateFileMapping|win32 error|fatal error -/i },
];

/** 分类 stderr → PushErrorType（UNKNOWN 兜底；RUNTIME_CRASH 在分类器无命中时按"非零退出+空/畸态 stderr"再判） */
function classifyPushError(exitCode: number, stderr: string): PushErrorType {
  for (const c of PUSH_ERROR_CLASSIFIERS) {
    if (c.pattern.test(stderr)) return c.type;
  }
  // 非零退出 + stderr 空或含 Windows 崩溃痕迹 → RUNTIME_CRASH（如 Git for Windows sh/bash CreateFileMapping 崩溃）
  if (exitCode !== 0 && (stderr.trim().length === 0 || /Program Files|sh\.exe|bash\.exe/.test(stderr))) {
    return 'RUNTIME_CRASH';
  }
  return 'UNKNOWN';
}

/** 分类对应的后续命令建议（next_actions，交模型/用户接管） */
function buildNextActions(type: PushErrorType, branch: string): string[] {
  switch (type) {
    case 'AUTH':
      return [
        '配置 HTTPS 访问令牌（CodeArts 控制台 → 个人设置 → 代码托管 → 访问令牌）或 SSH 密钥后重试',
        `git -c http.proxy=<代理> -c http.sslVerify=false push -u origin ${branch}`,
      ];
    case 'SSL':
      return [`git -c http.sslVerify=false -c http.proxy=<代理> push -u origin ${branch}（如仍未通，检查代理）`];
    case 'NETWORK':
      return [`确认内网代理可达后重试：git -c http.proxy=<代理> -c http.sslVerify=false push -u origin ${branch}`];
    case 'REJECTED_FETCH_FIRST':
      return [`git fetch origin && git rebase origin/${branch}（无共同祖先时 README 冲突取本地：git checkout --ours README.md）`, `git push -u origin ${branch}`];
    case 'RUNTIME_CRASH':
      return ['Git for Windows 环境崩溃（CreateFileMapping）——升级 git / 重装 Git for Windows 后重试，或转用户人工推送'];
    case 'UNKNOWN':
      return [`人工检查 git push 输出后重试（git push -u origin ${branch}）`];
  }
}

/** 校验入参（repoPath/projectUuid 必填 + 32 位小写校验） */
function validateInput(input: RepoPushHandlerInput): void {
  if (!input.repoPath || input.repoPath.trim().length === 0) {
    throw new ToolException('E_PARAM', 'repoPath 必填', '本地 git 仓库绝对路径');
  }
  if (!input.projectUuid || !/^[a-f0-9]{32}$/.test(input.projectUuid)) {
    throw new ToolException(
      'E_PARAM',
      `projectUuid 非法（32 位小写数字字母），实际: ${input.projectUuid ?? ''}`,
      'CodeArtsRepo 目标项目 UUID（= 会话 projectId，来自 list_projects 的 identifier）',
    );
  }
}

/**
 * 从本地 git 远端探测 codehub 仓库地址（P1：缺 remoteUrl 时自动探测，FE-12 §2.1）
 * - 优先 origin；其次任一含 codehub/devcloud 的远端
 * - 返回 { url, source: 'origin'|'remote' }；非 git 仓库/无 codehub 远端 → null
 */
async function detectRemoteUrl(repoPath: string): Promise<{ url: string; source: 'origin' | 'remote' } | null> {
  try {
    const { stdout } = await runGit(['remote', '-v'], repoPath, 30_000);
    const lines = stdout.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return null;
    // 优先 origin
    const originLine = lines.find((l) => l.trim().startsWith('origin'));
    if (originLine) {
      const url = originLine.split(/\s+/)[1] ?? '';
      if (url && /codehub|devcloud/i.test(url)) return { url, source: 'origin' };
    }
    // 任一含 codehub 的远端
    const anyLine = lines.find((l) => /codehub|devcloud/i.test(l));
    if (anyLine) {
      const url = anyLine.split(/\s+/)[1] ?? '';
      if (url) return { url, source: 'remote' };
    }
    return null;
  } catch {
    return null; // 非 git 仓库 → 走 missing_remote_url
  }
}

/**
 * repo_push 工具 handler：本地仓库 → CodeArtsRepo 推送（一次智能尝试 + 失败分类）
 */
export async function repoPushHandler(input: RepoPushHandlerInput): Promise<ToolResult> {
  const branch = input.branch ?? 'master';
  try {
    // ① 入参校验
    validateInput(input);
    const repoPath = path.resolve(input.repoPath);
    const repoName = input.repoName ?? path.basename(repoPath);
    let remoteUrl = input.remoteUrl ?? '';
    const proxyUrl = input.proxyUrl ?? 'http://proxycn2.huawei.com:8080';
    const sslVerify = input.sslVerify ?? false;

    // ①.5 缺 remoteUrl → 自动探测本地 codehub 远端（FE-12 P1：不再直接放弃）
    let detectedRemote: { url: string; source: 'origin' | 'remote' } | null = null;
    if (!remoteUrl) {
      detectedRemote = await detectRemoteUrl(repoPath);
      if (detectedRemote) remoteUrl = detectedRemote.url;
    }

    if (!remoteUrl) {
      return makeSuccessResult(
        { pushed: false, branch, reason: 'missing_remote_url', error: { error_type: 'UNKNOWN', message: '未提供 remoteUrl 且本地无 codehub 远端可探测——请先用 repo_prepare 建仓并取回 remote_url，再调用 repo_push' }, next_actions: ['先调用 codeartsbuild_repo_prepare 获取 remote_url'] },
        'repo_push: 缺少 remoteUrl——需先 repo_prepare 建仓并取回 remote_url',
      );
    }

    // ② origin 预检（git remote -v）：origin 项目 UUID ≠ projectUuid → project_mismatch，不推送
    let originUrl = '';
    try {
      const { stdout } = await runGit(['remote', '-v'], repoPath, 30_000);
      originUrl = stdout.split('\n').find((l) => l.includes('origin'))?.split(/\s+/)[1] ?? '';
    } catch {
      originUrl = ''; // 非 git 仓库 / 无 origin → 稍后 remote add
    }
    const originProjectUuid = originUrl ? parseProjectUuidFromRemoteUrl(originUrl) : null;
    if (originUrl && originProjectUuid && originProjectUuid !== input.projectUuid) {
      const remoteUrlSource: 'explicit' | 'detected' = input.remoteUrl ? 'explicit' : 'detected';
      return makeSuccessResult(
        {
          pushed: false,
          remote_url: remoteUrl,
          branch,
          repo_name: repoName,
          origin_url: originUrl,
          origin_project_uuid: originProjectUuid,
          project_mismatch: true,
          remote_url_source: remoteUrlSource,
          error: { error_type: 'UNKNOWN', message: `本地 origin（${originUrl}）指向项目 ${originProjectUuid}，与目标 projectUuid（${input.projectUuid}）不一致` },
          next_actions: [
            `确认目标仓库地址后执行：git remote set-url origin ${remoteUrl} && git push -u origin ${branch}`,
            '如本意是切换到 origin 所属项目，请先刷新会话 projectId 并重新 repo_prepare',
          ],
        },
        `repo_push: origin 指向项目 ${originProjectUuid} 与目标 projectUuid（${input.projectUuid}）不一致——已阻止推送，请确认后重试`,
      );
    }

    // ③ 确保 origin 指向目标 remoteUrl（已存在 → set-url；不存在 → add）
    if (originUrl && originUrl !== remoteUrl) {
      await runGit(['remote', 'set-url', 'origin', remoteUrl], repoPath);
    } else if (!originUrl) {
      await runGit(['remote', 'add', 'origin', remoteUrl], repoPath);
    }

    // ③.5 附加探测来源标注（P1）：remote_url_source 供模型判断是否已建仓
    const remoteUrlSource: 'explicit' | 'detected' = input.remoteUrl ? 'explicit' : 'detected';
    const detectedHint = detectedRemote
      ? `（remoteUrl 自动探测自本地 ${detectedRemote.source === 'origin' ? 'origin' : '远端'}——若尚未 repo_prepare 建仓，请先确认该仓库存在）`
      : '';

    // ④ 首次推送：携带内网三要素（代理 + SSL 关闭）
    const baseArgs = ['-c', `http.proxy=${proxyUrl}`, '-c', `http.sslVerify=${sslVerify}`];
    const pushArgs = [...baseArgs, 'push', '-u', 'origin', branch];
    const first = await runGit(pushArgs, repoPath);

    // ⑤ 失败分类 + SSL/NETWORK 携参自动重试一次（形态 B 的"智能尝试"）
    if (first.exitCode !== 0) {
      const errType = classifyPushError(first.exitCode, first.stderr);
      // SSL/NETWORK 才值得自动重试（AUTH/REJECTED/RUNTIME_CRASH/UNKNOWN 交模型/用户）
      if (errType === 'SSL' || errType === 'NETWORK') {
        const retry = await runGit(pushArgs, repoPath);
        if (retry.exitCode === 0) {
          return makeSuccessResult(
            { pushed: true, remote_url: remoteUrl, branch, repo_name: repoName, retry_applied: true, remote_url_source: remoteUrlSource, first_error: { error_type: errType, message: first.stderr.slice(0, 300) } },
            `repo_push: 首次推送失败（${errType}），携代理+SSL 重试成功——代码已推送至 CodeArtsRepo（${repoName}, ${branch}）${detectedHint}`,
          );
        }
        // 重试仍失败 → 归为新失败类型
        const retryType = classifyPushError(retry.exitCode, retry.stderr);
        return makeSuccessResult(
          {
            pushed: false,
            remote_url: remoteUrl,
            branch,
            repo_name: repoName,
            retry_applied: true,
            remote_url_source: remoteUrlSource,
            error: { error_type: retryType, message: retry.stderr.slice(0, 500), process_hint: retry.stderr.slice(0, 200) },
            next_actions: buildNextActions(retryType, branch),
          },
          `repo_push: 推送失败（${retryType}，已自动重试一次）——${retry.stderr.slice(0, 300)}${detectedHint}`,
        );
      }
      // 非可自动重试类 → 分类输出
      return makeSuccessResult(
        {
          pushed: false,
          remote_url: remoteUrl,
          branch,
          repo_name: repoName,
          retry_applied: false,
          remote_url_source: remoteUrlSource,
          error: { error_type: errType, message: first.stderr.slice(0, 500), process_hint: first.stderr.slice(0, 200) },
          next_actions: buildNextActions(errType, branch),
        },
        `repo_push: 推送失败（${errType}）——${first.stderr.slice(0, 300)}${detectedHint}`,
      );
    }

    // ⑥ 推送成功
    return makeSuccessResult(
      { pushed: true, remote_url: remoteUrl, branch, repo_name: repoName, retry_applied: false, remote_url_source: remoteUrlSource },
      `repo_push: 代码已推送至 CodeArtsRepo（${repoName}, ${branch}）${detectedHint}`,
    );
  } catch (e) {
    return mapToolError(e, 'E_API');
  }
}
