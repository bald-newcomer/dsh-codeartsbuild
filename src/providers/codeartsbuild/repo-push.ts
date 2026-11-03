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
 * 凭据机制化（FE-15，2026-10-23 会话 63534983）：
 *   - 新增 accessToken 入参：提供时工具自动构造 https://private-token:<TOKEN>@codehub... 一次性
 *     push URL（git -c remote.origin.url=... 进程级覆盖，**不写盘、不改 origin 配置、不进输出**）
 *   - 推送前认证预检：无 accessToken 时探测本地凭据（remote URL 已含 @user:pass / credential.helper 已配置），
 *     均无 → 结构化返回 reason:missing_credentials 引导用户提供令牌，**不盲目撞 AUTH**
 *   - private-token 用户名固定（会话 58dccf5f/63534983 实测：oauth2:/裸 token/AK:SK 拼接均被拒）
 * 不代执行交互式凭据（GCM/访问令牌）——分类 AUTH 后交模型/用户（2026-09-23 实测 HTTPS 需 GCM 交互）。
 * 承载：git 客户端本地执行（spawn, shell），无需云侧 HTTP。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import { parseProjectUuidFromRemoteUrl } from './repo-prepare.js';
import { loadFileEnv } from '../../infra/credential-provider.js';

/** CodeArtsRepo 访问令牌环境变量键（`.dsh-codearts` key=value 或 env，FE-15 扩展） */
export const CODEARTSREPO_TOKEN_ENV = 'CAB_CODEARTSREPO_TOKEN';

/**
 * 解析访问令牌来源（FE-15：input.accessToken 显式 > env/`.dsh-codearts` 的 CAB_CODEARTSREPO_TOKEN）
 * - loadFileEnv()：幂等把 `.dsh-codearts` 内容合入 process.env（已有环境变量优先，不覆盖）
 * - 返回 undefined 表示未配置令牌（走认证预检引导）
 * @internal 导出供 get_push_credential 工具复用
 */
export function resolveAccessToken(explicit?: string): string | undefined {
  if (explicit && explicit.trim()) return explicit.trim();
  loadFileEnv(); // 确保 .dsh-codearts 的 CAB_CODEARTSREPO_TOKEN 合入 env
  const envToken = process.env[CODEARTSREPO_TOKEN_ENV];
  return envToken?.trim() || undefined;
}

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
  /** HTTPS 访问令牌（可选，FE-15：提供时工具自动构造 https://private-token:<TOKEN>@... push URL，不落盘） */
  accessToken?: string;
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
  | 'PROXY_AUTH'
  | 'PROTECTED_BRANCH'
  | 'REJECTED_FETCH_FIRST'
  | 'RUNTIME_CRASH'
  | 'UNKNOWN';

interface PushErrorClassifier {
  type: PushErrorType;
  pattern: RegExp;
}

const PUSH_ERROR_CLASSIFIERS: PushErrorClassifier[] = [
  { type: 'PROXY_AUTH', pattern: /CONNECT tunnel failed.*407|407.*Proxy Authentication Required|proxy authentication required/i },
  { type: 'PROTECTED_BRANCH', pattern: /protected branch|cannot force push|force.*push.*denied|refusing to push.*protected|! \[remote rejected\].*protected/i },
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

/**
 * 分类对应的后续命令建议（next_actions，交模型/用户接管）
 * FE-15 §2.1 优化：失败时若已有 token，next_actions 直接给出含 token URL 的可执行宿主命令——
 * 模型复制即可用，不用自行拼 URL（2026-10-27 会话 1d8dc38a：模型在 repo_push 失败后转用 pwsh
 * 手动操作时未复用 token，step 18 无 token 命令失败、step 19 才手动拼 token URL）。
 *
 * @param remoteUrl 目标远端 URL（注入 token 用）
 * @param accessToken 已解析的 token（可能来自 input/env/.dsh-codearts）；有则注入到建议命令
 * @param branch 推送分支
 */
function buildNextActions(type: PushErrorType, remoteUrl: string, accessToken: string | undefined, branch: string): string[] {
  // 有 token 时构造带凭据的 URL（供宿主命令直接用，模型复制即可）
  const authedUrl = accessToken ? buildAuthedUrl(remoteUrl, accessToken) : remoteUrl;
  const tokenHint = accessToken
    ? `（已配置 accessToken，可直接用以下命令，无需自行拼 URL）`
    : `（未配置 accessToken，请用户提供 CodeArtsRepo 访问令牌后重试，或配置 SSH 密钥）`;
  switch (type) {
    case 'PROXY_AUTH':
      // 407 代理认证：repo_push 的 -c http.proxy 在需 NTLM 认证的代理环境不通——
      // 建议用宿主命令推送（系统代理自动处理 NTLM），命令中复用 token URL
      return accessToken
        ? [
            `代理需 NTLM 认证，repo_push 的 http.proxy 在此环境不通——用宿主命令推送（系统代理自动处理 NTLM）：git remote set-url origin ${authedUrl} && git -c http.sslVerify=false push -u origin ${branch}`,
            `或直接用 git push 命令：git -c http.sslVerify=false -c http.extraHeader="" push ${authedUrl} ${branch}`,
          ]
        : [
            '代理需 NTLM 认证，repo_push 的 http.proxy 在此环境不通——请用户提供 CodeArtsRepo 访问令牌后重试 repo_push（工具会自动注入 token 到建议命令中）',
            '或配置 SSH 密钥后重试（SSH 免令牌推送，且不受代理 NTLM 认证影响）',
          ];
    case 'AUTH':
      return [
        '请用户提供 CodeArtsRepo HTTPS 访问令牌（CodeArts 控制台 → 个人设置 → 代码托管 → 访问令牌）后，携带 accessToken 参数重试 repo_push（工具自动注入 private-token 用户名，勿自行拼 URL）',
        '或配置 SSH 密钥后重试（SSH 免令牌推送）',
      ];
    case 'PROTECTED_BRANCH':
      // FE-16 §2.3（2026-11-03 会话 e3c9f738）：模型在 pwsh 中用 git push -f 撞 master 受保护——
      // next_actions 引导走 pull --rebase（非 -f），或联系管理员开临时强推权限
      return [
        `目标分支 ${branch} 受保护，禁止 force push（git push -f）——用 git pull --rebase origin ${branch} 后 git push -u origin ${branch}（非 -f）`,
        `或联系项目管理员为本次构建开临时强推权限后重试`,
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
      // 有 token 时给出可直接复用的宿主命令（模型在 repo_push 失败后常转用 pwsh，此处让它能复用 token）
      return accessToken
        ? [
            `repo_push 失败，可尝试用宿主命令推送（已配置 accessToken，无需自行拼 URL）：git remote set-url origin ${authedUrl} && git -c http.sslVerify=false push -u origin ${branch}`,
            `或直接推送：git -c http.sslVerify=false push ${authedUrl} ${branch}`,
          ]
        : [`人工检查 git push 输出后重试（git push -u origin ${branch}）${tokenHint}`];
  }
}

/**
 * 校验入参（repoPath/projectUuid 必填 + 32 位小写校验）
 */
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
 * 非 git 仓库预检（FE-13 §2.2，2026-10-16 会话 58dccf5f P1）
 * 会话证据：本地目录无 .git → repo_push 把 remote -v 失败静默吞成空 origin → push 撞 UNKNOWN，
 * 模型被迫手动 git init（还吃一次沙箱拒绝）。此处前置探测，结构化提示先 git init。
 *
 * 用 git rev-parse --git-dir 而非 fs.existsSync(.git)：规避 worktree/submodule（.git 为 gitfile 指向外置 gitdir）误判。
 * @returns true=是 git 仓库；false=非 git 仓库
 */
async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    const { exitCode } = await runGit(['rev-parse', '--git-dir'], repoPath, 15_000);
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * 获取本地当前分支（FE-16 §2.3 分支预检，2026-11-03 会话 e3c9f738）
 * `git rev-parse --abbrev-ref HEAD` → 当前分支名（detached HEAD 时返回 `HEAD`）
 * @returns 当前分支名；获取失败（非 git 仓库等）返回 null
 */
async function getCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const { exitCode, stdout } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath, 15_000);
    if (exitCode !== 0) return null;
    const branch = stdout.trim();
    return branch || null;
  } catch {
    return null;
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

/** 判断 URL 是否已内嵌凭据（https://user:pass@host 或 https://token@host） */
function urlHasEmbeddedCredentials(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.username !== '' || parsed.password !== '';
  } catch {
    return false;
  }
}

/**
 * 本地凭据探测（FE-15 §2.2 认证预检）：检查是否已具备可推送凭据
 * ① 目标 remoteUrl（或 origin）URL 是否已内嵌 user:pass
 * ② 是否已配置 credential.helper（git config --get credential.helper）
 * @returns 无 accessToken 时判断本地是否已有凭据通道
 */
async function hasLocalCredential(remoteUrl: string, repoPath: string): Promise<boolean> {
  if (urlHasEmbeddedCredentials(remoteUrl)) return true;
  // remote -v 也检查一次（origin 可能已内嵌凭据而 remoteUrl 是干净的）
  try {
    const { stdout } = await runGit(['remote', '-v'], repoPath, 30_000);
    const originLine = stdout.split('\n').find((l) => l.trim().startsWith('origin'));
    const originUrl = originLine?.split(/\s+/)[1] ?? '';
    if (urlHasEmbeddedCredentials(originUrl)) return true;
  } catch {
    // 忽略 remote -v 失败（非 git 仓库已在预检拦掉）
  }
  // credential.helper 已配置（GCM/store/manager 等）→ 视为有凭据通道（可能仍需交互，失败再分类 AUTH）
  try {
    const { exitCode, stdout } = await runGit(['config', '--get', 'credential.helper'], repoPath, 15_000);
    if (exitCode === 0 && stdout.trim()) return true;
  } catch {
    // config 读取失败 → 视为无凭据
  }
  return false;
}

/**
 * 构造带凭据的一次性 push URL（FE-15 §1：private-token 用户名固定，实测 58dccf5f/63534983）
 * https://private-token:<TOKEN>@codehub...（不落盘——用 git -c remote.origin.url=... 进程级覆盖，不写 .git/config）
 */
export function buildAuthedUrl(remoteUrl: string, token: string): string {
  try {
    const parsed = new URL(remoteUrl);
    parsed.username = 'private-token';
    parsed.password = token;
    return parsed.toString();
  } catch {
    // URL 解析失败（SSH 地址等）→ 无法注入，原样返回（由 push 失败分类兜底）
    return remoteUrl;
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
    // FE-15：accessToken 来源（显式入参 > env/`.dsh-codearts` 的 CAB_CODEARTSREPO_TOKEN）
    const accessToken = resolveAccessToken(input.accessToken);

    // ①.25 非 git 仓库预检（FE-13 §2.2）：非 git 仓库 → 结构化提示先 git init，不撞 UNKNOWN
    const isGitRepo = await isGitRepository(repoPath);
    if (!isGitRepo) {
      return makeSuccessResult(
        {
          pushed: false,
          branch,
          repo_name: repoName,
          reason: 'not_git_repo',
          error: { error_type: 'UNKNOWN', message: `本地目录 ${repoPath} 不是 git 仓库（缺少 .git）——repo_push 只能推已有 git 仓库`, process_hint: 'git rev-parse --git-dir 探测失败' },
          next_actions: ['先在本地目录执行 git init && git add . && git commit -m "initial commit"，再重试 repo_push', '或先调用 codeartsbuild_repo_prepare（建仓+取 remote_url）后再推'],
        },
        'repo_push: 本地目录不是 git 仓库——请先 git init 并提交，再重试推送',
      );
    }

    // ①.35 分支预检（FE-16 §2.3，2026-11-03 会话 e3c9f738）：
    // 推送前校验本地当前分支与入参 branch 是否一致——不一致时返回 branch_mismatch 警告（不阻断，附 next_actions）
    // 会话证据：模型默认传 branch: master，但本地实际可能在 feature/* 等分支——误推到 master 会污染主干
    // 边界：detached HEAD（返回 HEAD）→ 视为不一致，警告但不阻断
    const currentBranch = await getCurrentBranch(repoPath);
    if (currentBranch && currentBranch !== 'HEAD' && currentBranch !== branch) {
      return makeSuccessResult(
        {
          pushed: false,
          branch,
          current_branch: currentBranch,
          reason: 'branch_mismatch',
          error: { error_type: 'UNKNOWN', message: `本地当前分支 ${currentBranch} ≠ 入参 branch ${branch}——确认推送哪个分支`, process_hint: 'git rev-parse --abbrev-ref HEAD 探测本地分支' },
          next_actions: [
            `确认推送当前分支：携带 branch: "${currentBranch}" 重试 repo_push`,
            `或确认推送 ${branch}：先 git checkout ${branch} 切换到目标分支，再重试 repo_push`,
          ],
        },
        `repo_push: 本地当前分支 ${currentBranch} ≠ 入参 branch ${branch}——请确认推送哪个分支后重试`,
      );
    }

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

    // ③.75 认证预检（FE-15 §2.2）：无 accessToken 且本地无凭据通道 → 结构化返回引导，不盲目撞 AUTH
    if (!accessToken) {
      const hasCred = await hasLocalCredential(remoteUrl, repoPath);
      if (!hasCred) {
        return makeSuccessResult(
          {
            pushed: false,
            remote_url: remoteUrl,
            branch,
            repo_name: repoName,
            reason: 'missing_credentials',
            remote_url_source: remoteUrlSource,
            error: { error_type: 'AUTH', message: '未提供 accessToken 且本地无可用凭据（remote URL 未内嵌凭据、未配置 credential.helper）——推送必然撞认证失败' },
            next_actions: [
              '请用户提供 CodeArtsRepo HTTPS 访问令牌（CodeArts 控制台 → 个人设置 → 代码托管 → 访问令牌）后，携带 accessToken 参数重试 repo_push',
              '或配置 SSH 密钥后重试（SSH 免令牌推送）',
            ],
          },
          'repo_push: 缺少认证凭据——请提供访问令牌（accessToken 参数）或配置 SSH 密钥后重试',
        );
      }
    }

    // ④ 首次推送：携带内网三要素（代理 + SSL 关闭）+ 凭据注入（FE-15 §1：accessToken → 一次性 private-token URL，不写盘）
    const baseArgs = ['-c', `http.proxy=${proxyUrl}`, '-c', `http.sslVerify=${sslVerify}`];
    const credArgs = accessToken
      ? [...baseArgs, '-c', `remote.origin.url=${buildAuthedUrl(remoteUrl, accessToken)}`]
      : baseArgs;
    const pushArgs = [...credArgs, 'push', '-u', 'origin', branch];
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
            next_actions: buildNextActions(retryType, remoteUrl, accessToken, branch),
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
          next_actions: buildNextActions(errType, remoteUrl, accessToken, branch),
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
