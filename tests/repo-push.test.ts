/**
 * repo_push handler 单测（Layer 1，mock child_process spawn，不执行真实 git push）
 * 对齐 FE-08 §5 形态 B（内置一次智能尝试）+ api-contract.md §2.18
 *
 * 2026-10-10：独立 repo_push 工具——origin 项目归属预检、代理+SSL 自动携带、
 * 失败 stderr 分类（AUTH/SSL/NETWORK/REJECTED_FETCH_FIRST/RUNTIME_CRASH/UNKNOWN）、
 * SSL/NETWORK 携参自动重试一次、输出 next_actions 交模型/用户接管。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoPushHandler, type RepoPushHandlerInput, CODEARTSREPO_TOKEN_ENV } from '../src/providers/codeartsbuild/repo-push.js';
import { DOT_DSH_CODEARTS, resetFileEnvCache } from '../src/infra/credential-provider.js';

/** mock child_process：保留 execFile（repo-prepare import 依赖），只替换 spawn */
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnMock };
});

function mockSpawn(exitCode: number, stdout: string, stderr: string) {
  const child = {
    stdout: { on: (ev: string, cb: (c: Buffer) => void) => ev === 'data' && cb(Buffer.from(stdout)) },
    stderr: { on: (ev: string, cb: (c: Buffer) => void) => ev === 'data' && cb(Buffer.from(stderr)) },
    on: (ev: string, cb: (arg?: unknown) => void) => {
      if (ev === 'error') return;
      if (ev === 'close') cb(exitCode);
    },
    kill: vi.fn(),
  };
  spawnMock.mockReturnValue(child);
}

/** 按命令路由模拟：remote -v → origin 输出；set-url/add → 成功；push → 指定结果 */
/** 注意：push 命令 args 以 `-c http.proxy` 开头，须用 args.includes('push') 匹配 */
function mockGitWithRoutes(opts: {
  originUrl?: string;
  pushExitCode?: number;
  pushStdout?: string;
  pushStderr?: string;
  isGitRepo?: boolean;
  hasCredentialHelper?: boolean;
  currentBranch?: string; // FE-16 §2.3：分支预检（git rev-parse --abbrev-ref HEAD）
}) {
  spawnMock.mockImplementation((cmd: string, args: string[], _opts: unknown) => {
    const isGit = cmd === 'git';
    // FE-16 §2.3：分支预检（git rev-parse --abbrev-ref HEAD）——须先于 git-dir 探测判断
    if (isGit && args.includes('rev-parse') && args.includes('--abbrev-ref')) {
      const branch = opts.currentBranch ?? 'master';
      return makeChild(0, branch + '\n', '');
    }
    // FE-13 §2.2：非 git 仓库预检（git rev-parse --git-dir）
    if (isGit && args.includes('rev-parse')) {
      const isRepo = opts.isGitRepo ?? true;
      return makeChild(isRepo ? 0 : 128, isRepo ? '.git' : '', isRepo ? '' : "fatal: not a git repository (or any of the parent directories): .git");
    }
    if (isGit && args.includes('remote')) {
      const origin = opts.originUrl ?? '';
      return makeChild(
        origin ? 0 : 1,
        origin ? `origin\t${origin} (fetch)\norigin\t${origin} (push)` : '',
        origin ? '' : 'fatal: not a git repository',
      );
    }
    // FE-15 §2.2：credential.helper 探测（hasLocalCredential 调用）
    if (isGit && args.includes('config') && args.includes('credential.helper')) {
      const hasHelper = opts.hasCredentialHelper ?? false;
      return makeChild(hasHelper ? 0 : 1, hasHelper ? 'store' : '', hasHelper ? '' : '');
    }
    if (isGit && (args.includes('set-url') || args.includes('add'))) {
      return makeChild(0, '', '');
    }
    if (isGit && args.includes('push')) {
      return makeChild(opts.pushExitCode ?? 0, opts.pushStdout ?? '', opts.pushStderr ?? '');
    }
    return makeChild(0, '', '');
  });
}

function makeChild(exitCode: number, stdout: string, stderr: string) {
  const child = {
    stdout: { on: (ev: string, cb: (c: Buffer) => void) => ev === 'data' && cb(Buffer.from(stdout)) },
    stderr: { on: (ev: string, cb: (c: Buffer) => void) => ev === 'data' && cb(Buffer.from(stderr)) },
    on: (ev: string, cb: (arg?: unknown) => void) => {
      if (ev === 'error') return;
      if (ev === 'close') cb(exitCode);
    },
    kill: vi.fn(),
  };
  return child;
}

function makeInput(overrides?: Partial<RepoPushHandlerInput>): RepoPushHandlerInput {
  return {
    repoPath: 'D:/code/demo-repo',
    projectUuid: 'aef718e1ac5f4bed9d74092b3ea582ca',
    remoteUrl: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git',
    ...overrides,
  };
}

beforeEach(() => {
  spawnMock.mockReset();
  delete process.env[CODEARTSREPO_TOKEN_ENV];
  resetFileEnvCache();
});

afterEach(() => {
  delete process.env[CODEARTSREPO_TOKEN_ENV];
  resetFileEnvCache();
});

describe('repoPushHandler', () => {
  it('成功：无 origin → remote add → push 成功 → pushed:true, retry_applied:false', async () => {
    mockGitWithRoutes({ originUrl: '', pushExitCode: 0 });

    const result = await repoPushHandler(makeInput({ accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
    expect(data.retry_applied).toBe(false);
    expect(data.branch).toBe('master');
    // 断言 push 命令携带代理 + SSL 参数（push args 以 `-c` 配置开头）
    const pushCall = spawnMock.mock.calls.find((c: unknown[]) => (c[0] as string) === 'git' && (c[1] as string[]).includes('push'));
    expect(pushCall).toBeTruthy();
    const args = pushCall[1] as string[];
    expect(args).toContain('http.proxy=http://proxycn2.huawei.com:8080');
    expect(args).toContain('http.sslVerify=false');
  });

  it('已有 origin 且项目一致 → remote set-url 对齐 remoteUrl → push 成功', async () => {
    mockGitWithRoutes({
      originUrl: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/old.git',
      pushExitCode: 0,
    });

    const result = await repoPushHandler(makeInput({ accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
    // 调用了 set-url
    const setUrlCall = spawnMock.mock.calls.find((c: unknown[]) => (c[1] as string[]).includes('set-url'));
    expect(setUrlCall).toBeTruthy();
  });

  it('SSL 失败一次 → 携参自动重试成功 → retry_applied:true', async () => {
    // push 第 1 次失败（SSL），第 2 次成功
    let pushCount = 0;
    spawnMock.mockImplementation((cmd: string, args: string[], _opts: unknown) => {
      if (cmd === 'git' && args.includes('remote')) return makeChild(1, '', 'fatal: not a git repository');
      if (cmd === 'git' && (args.includes('set-url') || args.includes('add'))) return makeChild(0, '', '');
      if (cmd === 'git' && args.includes('push')) {
        pushCount++;
        if (pushCount === 1) {
          return makeChild(1, '', 'fatal: unable to access ... SSL certificate OpenSSL verify result: self-signed certificate in certificate chain (19)');
        }
        return makeChild(0, '', '');
      }
      return makeChild(0, '', '');
    });

    const result = await repoPushHandler(makeInput({ accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
    expect(data.retry_applied).toBe(true);
    expect(pushCount).toBe(2);
  });

  it('AUTH 失败 → pushed:false，next_actions 含凭据指引，不自动重试', async () => {
    mockGitWithRoutes({ originUrl: '', pushExitCode: 1, pushStderr: 'remote: Authentication failed. Password is required.' });

    const result = await repoPushHandler(makeInput({ accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    const error = data.error as { error_type: string };
    expect(error.error_type).toBe('AUTH');
    // 只 push 一次（AUTH 不重试）
    const pushCalls = spawnMock.mock.calls.filter((c: unknown[]) => (c[0] as string) === 'git' && (c[1] as string[]).includes('push'));
    expect(pushCalls).toHaveLength(1);
    const next = data.next_actions as string[];
    expect(next.join(' ')).toContain('访问令牌');
  });

  it('RUNTIME_CRASH（Git for Windows CreateFileMapping 崩溃）→ 分类 RUNTIME_CRASH', async () => {
    mockGitWithRoutes({
      originUrl: '',
      pushExitCode: 1,
      pushStderr: '      0 [main] sh (29460) C:\\Program Files\\Git\\usr\\bin\\sh.exe: *** fatal error - CreateFileMapping S-1-5-21... Win32 error 5.  Terminating.',
    });

    const result = await repoPushHandler(makeInput({ accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    const error = data.error as { error_type: string };
    expect(error.error_type).toBe('RUNTIME_CRASH');
    const next = data.next_actions as string[];
    expect(next.join(' ')).toContain('升级');
  });

  it('origin 项目 UUID ≠ projectUuid → project_mismatch:true，不推送', async () => {
    // 本地 origin 指向另一项目 624d3c36...，目标 projectUuid = aef718e1...
    mockGitWithRoutes({
      originUrl: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/624d3c360116457693776843c45328a9/dsh-quant.git',
      pushExitCode: 0,
    });

    const result = await repoPushHandler(makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    expect(data.project_mismatch).toBe(true);
    expect(data.origin_project_uuid).toBe('624d3c360116457693776843c45328a9');
    // 未执行任何 push
    const pushCalls = spawnMock.mock.calls.filter((c: unknown[]) => (c[0] as string) === 'git' && (c[1] as string[]).includes('push'));
    expect(pushCalls).toHaveLength(0);
    const next = data.next_actions as string[];
    expect(next.join(' ')).toContain('set-url');
  });

  it('REJECTED_FETCH_FIRST → next_actions 含 fetch+rebase 指引', async () => {
    mockGitWithRoutes({
      originUrl: '',
      pushExitCode: 1,
      pushStderr: '! [rejected]        master -> master (fetch first)\nerror: failed to push some refs to ...',
    });

    const result = await repoPushHandler(makeInput({ accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    const error = data.error as { error_type: string };
    expect(error.error_type).toBe('REJECTED_FETCH_FIRST');
    const next = data.next_actions as string[];
    expect(next.join(' ')).toContain('git fetch origin');
  });

  it('缺少 remoteUrl 且本地无 codehub 远端 → 提示先 repo_prepare', async () => {
    mockGitWithRoutes({ originUrl: '' });

    const result = await repoPushHandler(makeInput({ remoteUrl: undefined }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    expect(result.content[0].text).toContain('repo_prepare');
  });

  // ─── 2026-10-11（FE-12 P1）：缺 remoteUrl 自动探测本地 codehub 远端 ───

  it('缺 remoteUrl + 本地 origin 为 codehub → 自动探测并推送成功（remote_url_source=detected）', async () => {
    mockGitWithRoutes({
      originUrl: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git',
      pushExitCode: 0,
    });

    const result = await repoPushHandler(makeInput({ remoteUrl: undefined, accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
    expect(data.remote_url_source).toBe('detected');
    expect(data.remote_url).toContain('codehub.devcloud');
  });

  it('缺 remoteUrl + 本地 origin 为第三方平台（github）→ 提示先 repo_prepare（拒绝探测）', async () => {
    mockGitWithRoutes({ originUrl: 'https://github.com/x/demo.git', pushExitCode: 0 });

    const result = await repoPushHandler(makeInput({ remoteUrl: undefined }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    expect(result.content[0].text).toContain('repo_prepare');
  });

  it('缺 remoteUrl + 非 git 仓库 → missing_remote_url 兜底', async () => {
    // mockGitWithRoutes originUrl '' → remote -v 返回 fatal: not a git repository
    mockGitWithRoutes({ originUrl: '', isGitRepo: true });

    const result = await repoPushHandler(makeInput({ remoteUrl: undefined }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    expect(data.reason).toBe('missing_remote_url');
  });

  it('FE-13: 本地非 git 仓库（rev-parse 失败）→ not_git_repo，不撞 UNKNOWN，next_actions 含 git init', async () => {
    mockGitWithRoutes({ isGitRepo: false });

    const result = await repoPushHandler(makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    expect(data.reason).toBe('not_git_repo');
    const nextActions = (data.next_actions ?? []) as string[];
    expect(nextActions.join(' ')).toContain('git init');
    // 非 git 仓库时不应继续走 remote/push（不触发 set-url/add/push 命令）
    const calls = spawnMock.mock.calls as [string, string[]][];
    const gitCommands = calls.filter(([cmd]) => cmd === 'git').map(([, args]) => args[0]);
    expect(gitCommands).not.toContain('push');
  });

  it('FE-13: git 仓库（rev-parse 成功）→ 维持原流程正常推送', async () => {
    mockGitWithRoutes({ originUrl: '', isGitRepo: true });

    const result = await repoPushHandler(makeInput({ accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
  });

  it('projectUuid 非法（非 32 位）应抛 E_PARAM', async () => {
    mockGitWithRoutes({ originUrl: '' });
    const result = await repoPushHandler(makeInput({ projectUuid: 'short' }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('projectUuid');
  });

  it('repoPath 缺失应抛 E_PARAM', async () => {
    mockGitWithRoutes({ originUrl: '' });
    const result = await repoPushHandler(makeInput({ repoPath: '' }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
  });

  // ─── FE-15 凭据机制化（2026-10-23 会话 63534983）───

  it('FE-15: 无 accessToken + 本地无凭据 → reason:missing_credentials，不触发 push', async () => {
    // 在无 .dsh-codearts 的临时目录跑（防项目根 .dsh-codearts 泄漏 env + 防真实 git credential.helper 干扰）
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-missingcred-'));
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      // remote -v 无 origin（无内嵌凭据），config credential.helper 未配置
      mockGitWithRoutes({ originUrl: '', pushExitCode: 0, hasCredentialHelper: false });

      const result = await repoPushHandler(makeInput());

      expect(result.isError).toBe(false);
      const data = result.data as Record<string, unknown>;
      expect(data.pushed).toBe(false);
      expect(data.reason).toBe('missing_credentials');
      const next = (data.next_actions ?? []) as string[];
      expect(next.join(' ')).toContain('accessToken');
      // 未触发 push
      const pushCalls = spawnMock.mock.calls.filter((c: unknown[]) => (c[0] as string) === 'git' && (c[1] as string[]).includes('push'));
      expect(pushCalls).toHaveLength(0);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FE-15: 提供 accessToken → push 命令注入 private-token 凭据 URL（-c remote.origin.url），成功且输出不含 token', async () => {
    mockGitWithRoutes({ originUrl: '', pushExitCode: 0 });

    const result = await repoPushHandler(makeInput({ accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
    // push args 含一次性凭据 URL（不写盘：-c 进程级覆盖）
    const pushCall = spawnMock.mock.calls.find((c: unknown[]) => (c[0] as string) === 'git' && (c[1] as string[]).includes('push'));
    expect(pushCall).toBeTruthy();
    const args = pushCall[1] as string[];
    const credArg = args.find((a) => a.startsWith('remote.origin.url='));
    expect(credArg).toBeTruthy();
    expect(credArg).toContain('https://private-token:TVvzeJjaVXi1QnZ6Jh5E7Cky@');
    // 输出不含 token（防泄露）
    const outJson = JSON.stringify(result.data);
    expect(outJson).not.toContain('TVvzeJjaVXi1QnZ6Jh5E7Cky');
    // 成功路径不写盘：remote add 用的仍是干净 URL
    const addCall = spawnMock.mock.calls.find((c: unknown[]) => (c[1] as string[]).includes('add'));
    expect(addCall).toBeTruthy();
    const addArgs = addCall[1] as string[];
    expect(addArgs.join(' ')).not.toContain('private-token');
  });

  it('FE-15: 提供 accessToken 且 push 仍 AUTH 失败 → AUTH 分类，next_actions 引导携带 accessToken 重试', async () => {
    mockGitWithRoutes({
      originUrl: '',
      pushExitCode: 1,
      pushStderr: 'remote: Authentication failed. Password is required.',
    });

    const result = await repoPushHandler(makeInput({ accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    const error = data.error as { error_type: string };
    expect(error.error_type).toBe('AUTH');
    const next = (data.next_actions ?? []) as string[];
    expect(next.join(' ')).toContain('accessToken');
  });

  it('FE-15: 407 代理认证失败 → PROXY_AUTH 分类，next_actions 含可执行的含 token 宿主命令', async () => {
    mockGitWithRoutes({
      originUrl: '',
      pushExitCode: 1,
      pushStderr: 'fatal: unable to access ...: CONNECT tunnel failed, response 407',
    });

    const result = await repoPushHandler(makeInput({ accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    const error = data.error as { error_type: string };
    expect(error.error_type).toBe('PROXY_AUTH');
    const next = (data.next_actions ?? []) as string[];
    // next_actions 含可执行的宿主命令（含 token URL，模型复制即可用）
    const nextText = next.join(' ');
    expect(nextText).toContain('private-token:TVvzeJjaVXi1QnZ6Jh5E7Cky@');
    expect(nextText).toContain('git');
    expect(nextText).toContain('push');
  });

  it('FE-15: 407 代理认证失败 + 无 token → PROXY_AUTH 分类（无 token 时 next_actions 引导用户提供）', async () => {
    // 测 407 分类逻辑：push 失败 stderr 含 407 → PROXY_AUTH（非 AUTH）
    // 用 accessToken 让流程走到 push（避免 missing_credentials 预检拦截），但 token 是假的——
    // 实际测的是 classifyPushError 对 407 stderr 的分类
    mockGitWithRoutes({
      originUrl: '',
      pushExitCode: 1,
      pushStderr: 'fatal: unable to access ...: CONNECT tunnel failed, response 407',
    });

    const result = await repoPushHandler(makeInput({ accessToken: 'fake-token-for-407-test' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    const error = data.error as { error_type: string };
    expect(error.error_type).toBe('PROXY_AUTH');
    // 无 token 场景被 missing_credentials 预检拦截（另有用例覆盖）；此处 407 分类用假 token 走到 push
    // next_actions 应含可执行宿主命令（含 fake token URL）
    const next = (data.next_actions ?? []) as string[];
    expect(next.join(' ')).toContain('private-token:fake-token-for-407-test@');
  });

  it('FE-15: UNKNOWN 失败 + 有 token → next_actions 含可执行的含 token 宿主命令（模型转 pwsh 时能复用 token）', async () => {
    mockGitWithRoutes({
      originUrl: '',
      pushExitCode: 1,
      pushStderr: 'some unknown error',
    });

    const result = await repoPushHandler(makeInput({ accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    const error = data.error as { error_type: string };
    expect(error.error_type).toBe('UNKNOWN');
    const next = (data.next_actions ?? []) as string[];
    // next_actions 含可执行的宿主命令（含 token URL——模型转 pwsh 时复制即可用，不自行拼 URL）
    const nextText = next.join(' ');
    expect(nextText).toContain('private-token:TVvzeJjaVXi1QnZ6Jh5E7Cky@');
    expect(nextText).toContain('push');
  });

  it('FE-15: 无 accessToken 但 remote URL 已内嵌凭据 → 跳过预检直接推送', async () => {
    // origin 已内嵌凭据（https://user:pass@codehub...）→ hasLocalCredential 命中
    mockGitWithRoutes({
      originUrl: 'https://private-token:secret@codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git',
      pushExitCode: 0,
    });

    const result = await repoPushHandler(makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
    // 未返回 missing_credentials
    expect(data.reason).toBeUndefined();
  });

  it('FE-15: 无 accessToken 但已配置 credential.helper → 跳过预检直接推送', async () => {
    // credential.helper 已配置（git config --get credential.helper 成功）
    spawnMock.mockImplementation((cmd: string, args: string[], _opts: unknown) => {
      // FE-16 §2.3：分支预检（--abbrev-ref HEAD 须返回分支名，非 .git）
      if (cmd === 'git' && args.includes('rev-parse') && args.includes('--abbrev-ref')) return makeChild(0, 'master\n', '');
      if (cmd === 'git' && args.includes('rev-parse')) return makeChild(0, '.git', '');
      if (cmd === 'git' && args.includes('remote')) return makeChild(1, '', 'fatal: not a git repository');
      if (cmd === 'git' && args.includes('config')) return makeChild(0, 'manager', '');
      if (cmd === 'git' && (args.includes('set-url') || args.includes('add'))) return makeChild(0, '', '');
      if (cmd === 'git' && args.includes('push')) return makeChild(0, '', '');
      return makeChild(0, '', '');
    });

    const result = await repoPushHandler(makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
    expect(data.reason).toBeUndefined();
  });

  // ─── FE-15：accessToken 来源（显式 > env/`.dsh-codearts`）───

  it('FE-15: 环境变量 CAB_CODEARTSREPO_TOKEN 提供 token → 自动注入 private-token 凭据', async () => {
    process.env[CODEARTSREPO_TOKEN_ENV] = 'ENV_TOKEN_12345';
    mockGitWithRoutes({ originUrl: '', pushExitCode: 0 });

    const result = await repoPushHandler(makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
    const pushCall = spawnMock.mock.calls.find((c: unknown[]) => (c[0] as string) === 'git' && (c[1] as string[]).includes('push'));
    const args = pushCall[1] as string[];
    const credArg = args.find((a) => a.startsWith('remote.origin.url='));
    expect(credArg).toContain('https://private-token:ENV_TOKEN_12345@');
    // 输出不含 token（防泄露）
    expect(JSON.stringify(result.data)).not.toContain('ENV_TOKEN_12345');
  });

  it('FE-15: `.dsh-codearts` 文件提供 token（CAB_CODEARTSREPO_TOKEN 键）→ 自动注入', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-pushtoken-'));
    fs.writeFileSync(path.join(dir, DOT_DSH_CODEARTS), `CAB_CODEARTSREPO_TOKEN=FILE_TOKEN_67890\n`);
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      mockGitWithRoutes({ originUrl: '', pushExitCode: 0 });
      const result = await repoPushHandler(makeInput());
      expect(result.isError).toBe(false);
      const data = result.data as Record<string, unknown>;
      expect(data.pushed).toBe(true);
      const pushCall = spawnMock.mock.calls.find((c: unknown[]) => (c[0] as string) === 'git' && (c[1] as string[]).includes('push'));
      const args = pushCall[1] as string[];
      const credArg = args.find((a) => a.startsWith('remote.origin.url='));
      expect(credArg).toContain('https://private-token:FILE_TOKEN_67890@');
      expect(JSON.stringify(result.data)).not.toContain('FILE_TOKEN_67890');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FE-15: 显式 accessToken 优先于环境变量', async () => {
    process.env[CODEARTSREPO_TOKEN_ENV] = 'ENV_TOKEN_12345';
    mockGitWithRoutes({ originUrl: '', pushExitCode: 0 });

    const result = await repoPushHandler(makeInput({ accessToken: 'EXPLICIT_TOKEN_abc' }));

    expect(result.isError).toBe(false);
    const pushCall = spawnMock.mock.calls.find((c: unknown[]) => (c[0] as string) === 'git' && (c[1] as string[]).includes('push'));
    const args = pushCall[1] as string[];
    const credArg = args.find((a) => a.startsWith('remote.origin.url='));
    expect(credArg).toContain('https://private-token:EXPLICIT_TOKEN_abc@');
    expect(credArg).not.toContain('ENV_TOKEN_12345');
  });

  // ─── FE-16 §2.3：推码分支预检 + PROTECTED_BRANCH 分类（2026-11-03 会话 e3c9f738）───

  it('FE-16: 本地当前分支 ≠ 入参 branch → branch_mismatch 警告，不推送', async () => {
    // 会话证据：模型默认传 branch: master，但本地可能在 feature/* 分支——误推到 master 会污染主干
    mockGitWithRoutes({
      originUrl: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git',
      currentBranch: 'feature/uv-build', // 本地当前分支 ≠ 入参 master
      pushExitCode: 0,
    });

    const result = await repoPushHandler(makeInput({ branch: 'master' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    expect(data.reason).toBe('branch_mismatch');
    expect(data.current_branch).toBe('feature/uv-build');
    expect(data.branch).toBe('master');
    // next_actions 引导确认推送哪个分支
    const actions = data.next_actions as string[];
    expect(actions.some((a) => a.includes('feature/uv-build'))).toBe(true);
    expect(actions.some((a) => a.includes('master'))).toBe(true);
    // 不应触发 push 命令
    const pushCall = spawnMock.mock.calls.find((c: unknown[]) => (c[0] as string) === 'git' && (c[1] as string[]).includes('push'));
    expect(pushCall).toBeUndefined();
  });

  it('FE-16: 本地当前分支 = 入参 branch → 正常推送（分支预检放行）', async () => {
    mockGitWithRoutes({
      originUrl: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git',
      currentBranch: 'master', // 与入参一致
      pushExitCode: 0,
    });

    const result = await repoPushHandler(makeInput({ branch: 'master' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
    expect(data.reason).toBeUndefined();
  });

  it('FE-16: detached HEAD（currentBranch=HEAD）→ 不拦分支预检（视为一致，正常推送）', async () => {
    // detached HEAD 时 git rev-parse --abbrev-ref HEAD 返回 "HEAD"——视为一致，不阻断
    mockGitWithRoutes({
      originUrl: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git',
      currentBranch: 'HEAD',
      pushExitCode: 0,
    });

    const result = await repoPushHandler(makeInput({ branch: 'master' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
  });

  it('FE-16: push -f 撞 master 受保护 → PROTECTED_BRANCH 分类，next_actions 引导 rebase 非 -f', async () => {
    // 会话证据 e3c9f738 [375]：git push -f origin master 撞 "master 分支受保护，不能强制推送"
    mockGitWithRoutes({
      originUrl: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git',
      currentBranch: 'master',
      pushExitCode: 1,
      pushStderr: '! [remote rejected] master -> master (protected branch hook declined)\nerror: failed to push some refs',
    });

    const result = await repoPushHandler(makeInput({ branch: 'master' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    const error = data.error as Record<string, unknown>;
    expect(error.error_type).toBe('PROTECTED_BRANCH');
    // next_actions 引导走 pull --rebase（非 -f）
    const actions = data.next_actions as string[];
    expect(actions.some((a) => a.includes('pull --rebase'))).toBe(true);
    // 不建议执行 push -f（next_actions 不应建议强制推送——可提及"禁止 force push"但不建议执行）
    expect(actions.some((a) => /^git\s+push\s+-f/.test(a.trim()))).toBe(false);
    // retry_applied 应为 false（PROTECTED_BRANCH 不自动重试）
    expect(data.retry_applied).toBe(false);
  });

  it('FE-16: "cannot force push to protected" stderr → PROTECTED_BRANCH 分类', async () => {
    mockGitWithRoutes({
      originUrl: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git',
      currentBranch: 'master',
      pushExitCode: 1,
      pushStderr: 'remote: error: cannot force push to a protected branch',
    });

    const result = await repoPushHandler(makeInput({ branch: 'master' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    const error = data.error as Record<string, unknown>;
    expect(error.error_type).toBe('PROTECTED_BRANCH');
  });

  it('FE-16: PROTECTED_BRANCH 不自动重试（retry_applied:false）', async () => {
    mockGitWithRoutes({
      originUrl: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git',
      currentBranch: 'master',
      pushExitCode: 1,
      pushStderr: 'refusing to push to protected branch',
    });

    const result = await repoPushHandler(makeInput({ branch: 'master' }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    expect(data.retry_applied).toBe(false);
    const error = data.error as Record<string, unknown>;
    expect(error.error_type).toBe('PROTECTED_BRANCH');
    // push 只调用一次（不重试）
    const pushCalls = spawnMock.mock.calls.filter((c: unknown[]) => (c[0] as string) === 'git' && (c[1] as string[]).includes('push'));
    expect(pushCalls.length).toBe(1);
  });
});
