/**
 * repo_push handler 单测（Layer 1，mock child_process spawn，不执行真实 git push）
 * 对齐 FE-08 §5 形态 B（内置一次智能尝试）+ api-contract.md §2.18
 *
 * 2026-10-10：独立 repo_push 工具——origin 项目归属预检、代理+SSL 自动携带、
 * 失败 stderr 分类（AUTH/SSL/NETWORK/REJECTED_FETCH_FIRST/RUNTIME_CRASH/UNKNOWN）、
 * SSL/NETWORK 携参自动重试一次、输出 next_actions 交模型/用户接管。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repoPushHandler, type RepoPushHandlerInput } from '../src/providers/codeartsbuild/repo-push.js';

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
}) {
  spawnMock.mockImplementation((cmd: string, args: string[], _opts: unknown) => {
    const isGit = cmd === 'git';
    if (isGit && args.includes('remote')) {
      const origin = opts.originUrl ?? '';
      return makeChild(
        origin ? 0 : 1,
        origin ? `origin\t${origin} (fetch)\norigin\t${origin} (push)` : '',
        origin ? '' : 'fatal: not a git repository',
      );
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
});

describe('repoPushHandler', () => {
  it('成功：无 origin → remote add → push 成功 → pushed:true, retry_applied:false', async () => {
    mockGitWithRoutes({ originUrl: '', pushExitCode: 0 });

    const result = await repoPushHandler(makeInput());

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

    const result = await repoPushHandler(makeInput());

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

    const result = await repoPushHandler(makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(true);
    expect(data.retry_applied).toBe(true);
    expect(pushCount).toBe(2);
  });

  it('AUTH 失败 → pushed:false，next_actions 含凭据指引，不自动重试', async () => {
    mockGitWithRoutes({ originUrl: '', pushExitCode: 1, pushStderr: 'remote: Authentication failed. Password is required.' });

    const result = await repoPushHandler(makeInput());

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

    const result = await repoPushHandler(makeInput());

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

    const result = await repoPushHandler(makeInput());

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

    const result = await repoPushHandler(makeInput({ remoteUrl: undefined }));

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
    mockGitWithRoutes({ originUrl: '' });

    const result = await repoPushHandler(makeInput({ remoteUrl: undefined }));

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.pushed).toBe(false);
    expect(data.reason).toBe('missing_remote_url');
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
});
