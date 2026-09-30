/**
 * repo_prepare handler 单测（Layer 1，mock HttpClient + child_process，不需网络）
 * 对齐 FE-08-本地远端仓库方案探索-20260923.md §5 + api-contract.md §2.17
 *
 * 2026-09-28 自 repo_push 瘦身改名：不做 git push（由模型用宿主命令工具执行），
 * 仅检测远端（只读）→ 建仓 → 回读 RepoInfo → 返回 remote_url + push_guidance。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { repoPrepareHandler, type RepoPrepareHandlerInput } from '../src/providers/codeartsbuild/repo-prepare.js';

// ─── mock child_process（runGitReadonly 依赖 execFile 经 util.promisify 包装）───
// 注意：Node 的 child_process.execFile 自带 util.promisify.custom，promisify 后 resolve {stdout, stderr}。
// mock 需保留该 custom 行为，否则 promisify 默认 resolve 单值，runGitReadonly 解构 {stdout, stderr} 会得到 undefined。
// 用 vi.hoisted 使 mock 在 vi.mock 工厂中可被测试代码引用。
const { mockExecFile, execFileImpl } = vi.hoisted(() => {
  const mockExecFile = vi.fn();
  const impl = (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    mockExecFile(cmd, args, opts, cb);
  };
  // 挂载 promisify.custom：resolve {stdout, stderr}
  Object.assign(impl, {
    async [Symbol.for('nodejs.util.promisify.custom')](cmd: string, args: string[], opts: unknown) {
      return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        mockExecFile(cmd, args, opts, (err: Error | null, stdout?: string, stderr?: string) => {
          if (err) reject(err);
          else resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
        });
      });
    },
  });
  return { mockExecFile, execFileImpl: impl };
});
vi.mock('node:child_process', () => ({
  execFile: execFileImpl,
}));

/** mock HttpClient.call（service=codeartsrepo 的仓库 API） */
const mockCall = vi.fn();

const fakeClient = { call: mockCall } as never;

function makeCtx() {
  return { client: fakeClient, session: {}, envProjectId: undefined };
}

function makeInput(overrides?: Partial<RepoPrepareHandlerInput>): RepoPrepareHandlerInput {
  return {
    repoPath: 'D:/code/demo-repo',
    projectUuid: 'aef718e1ac5f4bed9d74092b3ea582ca',
    ...overrides,
  };
}

/** git 命令模拟：按 args[0] 返回结果（注意：promisify(execFile) 解析为 {stdout, stderr}，两者都必须为字符串） */
function mockGitResults(results: Record<string, { stdout?: string; stderr?: string; error?: Error }>) {
  mockExecFile.mockImplementation((cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    const key = args[0] ?? '';
    const r = results[key] ?? {};
    if (r.error) {
      cb(r.error);
      return;
    }
    cb(null, r.stdout ?? '', r.stderr ?? '');
  });
}

beforeEach(() => {
  mockCall.mockReset();
  mockExecFile.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('repoPrepareHandler', () => {
  it('成功：无远端 → 建仓 → 回读 RepoInfo → 返回 remote_url + push_guidance（不执行 git push）', async () => {
    // git remote -v → 无输出（无远端）
    mockGitResults({ remote: { stdout: '' } });
    // HttpClient: CreateRepository → repository_uuid；GetRepository → RepoInfo
    mockCall
      .mockResolvedValueOnce({ result: { repository_uuid: 'b7eb2721ee0649c0af76360101783fc5' }, status: 'success' })
      .mockResolvedValueOnce({
        result: {
          id: 'b7eb2721ee0649c0af76360101783fc5',
          repoId: '3089998',
          name: 'demo-repo',
          sshUrl: 'git@codehub.devcloud.cn-north-4.huaweicloud.com:grp/demo-repo.git',
          httpUrl: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/grp/demo-repo.git',
          webUrl: 'https://devcloud.cn-north-4.huaweicloud.com/codehub/3089998/home',
          groupName: 'grp',
          projectId: 'aef718e1ac5f4bed9d74092b3ea582ca',
        },
        status: 'success',
      });

    const result = await repoPrepareHandler(makeCtx(), makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.repo_id).toBe('3089998');
    expect(data.repo_name).toBe('demo-repo');
    expect(data.url).toContain('codehub.devcloud');
    expect(data.web_url).toContain('codehub/3089998');
    expect(data.remote_url).toContain('https://codehub.devcloud');
    expect(data.push_guidance).toContain('git remote add origin');
    expect(data.push_guidance).toContain('git push -u origin master');
    // 验证 client.call 用了 service=codeartsrepo
    const [createReq] = mockCall.mock.calls[0] as [{ service: string; body: Record<string, unknown> }];
    expect(createReq.service).toBe('codeartsrepo');
    expect(createReq.body).toEqual({ project_uuid: 'aef718e1ac5f4bed9d74092b3ea582ca', name: 'demo-repo' });
    const [getReq] = mockCall.mock.calls[1] as [{ service: string; path: string }];
    expect(getReq.service).toBe('codeartsrepo');
    expect(getReq.path).toBe('/v1/repositories/b7eb2721ee0649c0af76360101783fc5');
    // 不执行任何 git push（push 由模型执行）
    const pushCalls = mockExecFile.mock.calls.filter((c: unknown[]) => c[1]?.[0] === 'push');
    expect(pushCalls).toHaveLength(0);
  });

  it('已有 codehub 远端且目标项目命中 → per-project 回读 repo_id，返回 existing_remote，不建仓、不 push', async () => {
    mockGitResults({
      remote: { stdout: 'origin\tgit@codehub.devcloud.cn-north-4.huaweicloud.com:grp/existing.git (fetch)\norigin\tgit@codehub.devcloud.cn-north-4.huaweicloud.com:grp/existing.git (push)' },
    });
    // per-project ListRepositoryByProject → 命中 existing；GetRepository → repoId
    mockCall
      .mockResolvedValueOnce({
        result: {
          total: 1,
          repositories: [{ repository_uuid: 'b7eb2721ee0649c0af76360101783fc5', repository_id: 3089998, repository_name: 'existing', project_uuid: 'aef718e1ac5f4bed9d74092b3ea582ca' }],
        },
        status: 'success',
      })
      .mockResolvedValueOnce({
        result: { id: 'b7eb2721ee0649c0af76360101783fc5', repoId: '3089998', name: 'existing', sshUrl: 'git@...:grp/existing.git', httpUrl: 'https://codehub.../grp/existing.git', webUrl: 'https://.../3089998', projectId: 'aef718e1ac5f4bed9d74092b3ea582ca' },
        status: 'success',
      });

    const result = await repoPrepareHandler(makeCtx(), makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.existing_remote).toBe(true);
    expect(data.url).toContain('codehub');
    // FE-09 P0-A：已有远端也回读 repo_id（供 create_job.scms）
    expect(data.repo_id).toBe('3089998');
    expect(data.repository_uuid).toBe('b7eb2721ee0649c0af76360101783fc5');
    // 调用了 per-project ListRepositoryByProject（uuid=入参 projectUuid）
    const [listReq] = mockCall.mock.calls[0] as [{ service: string; path: string }];
    expect(listReq.service).toBe('codeartsrepo');
    expect(listReq.path).toBe('/v1/projects/aef718e1ac5f4bed9d74092b3ea582ca/repositories');
    // 不执行任何 git push
    const pushCalls = mockExecFile.mock.calls.filter((c: unknown[]) => c[1]?.[0] === 'push');
    expect(pushCalls).toHaveLength(0);
  });

  it('已有 codehub 远端但目标项目未命中 → 在当前项目建仓（2026-09-29 决策），返回新仓库 RepoInfo', async () => {
    mockGitResults({
      remote: { stdout: 'origin\thttps://codehub.devcloud.cn-north-4.huaweicloud.com/624d3c360116457693776843c45328a9/dsh-quant.git (fetch)\norigin\thttps://codehub.devcloud.cn-north-4.huaweicloud.com/624d3c360116457693776843c45328a9/dsh-quant.git (push)' },
    });
    // per-project 查询 → 空（目标项目 aef718e1... 无此仓库）→ 建仓 → 回读
    mockCall
      .mockResolvedValueOnce({ result: { total: 0, repositories: [] }, status: 'success' })
      .mockResolvedValueOnce({ result: { repository_uuid: 'new-repo-uuid-1' }, status: 'success' })
      .mockResolvedValueOnce({
        result: { id: 'new-repo-uuid-1', repoId: '555', name: 'dsh-quant', sshUrl: 'git@...:grp/dsh-quant.git', httpUrl: 'https://codehub.../grp/dsh-quant.git', webUrl: 'https://.../555', projectId: 'aef718e1ac5f4bed9d74092b3ea582ca' },
        status: 'success',
      });

    const result = await repoPrepareHandler(makeCtx(), makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    // 未命中 → 建仓成功（非 existing_remote）
    expect(data.created_in_target_project).toBe(true);
    expect(data.repo_id).toBe('555');
    expect(data.repository_uuid).toBe('new-repo-uuid-1');
    expect(data.push_guidance).toContain('git remote add origin');
    // 建仓请求用入参 projectUuid
    const listReq = mockCall.mock.calls[0]?.[0] as { path: string } | undefined;
    const createReq = mockCall.mock.calls[1]?.[0] as { service: string; body: Record<string, unknown> } | undefined;
    expect(listReq?.path).toBe('/v1/projects/aef718e1ac5f4bed9d74092b3ea582ca/repositories');
    expect(createReq?.service).toBe('codeartsrepo');
    expect(createReq?.body).toEqual({ project_uuid: 'aef718e1ac5f4bed9d74092b3ea582ca', name: 'demo-repo' });
    // FE-09 R3 机制层：远端 URL 项目（624d3c36...）≠ 入参 projectUuid（aef718e1...）→ project_mismatch 警告
    expect(data.project_mismatch).toBe(true);
    expect(data.remote_project_uuid).toBe('624d3c360116457693776843c45328a9');
    expect(data.mismatch_hint).toContain('624d3c360116457693776843c45328a9');
    expect(data.mismatch_hint).toContain('aef718e1ac5f4bed9d74092b3ea582ca');
    expect(result.content[0].text).toContain('project_mismatch');
  });

  // ─── FE-09 R3 机制层 project_mismatch 警告（2026-09-29）───

  it('project_mismatch：已有远端命中但远端 URL 项目 ≠ 入参 projectUuid → 附 existing 场景警告', async () => {
    // 远端 URL 项目 = 624d3c36...，入参 projectUuid = aef718e1...（不一致）
    mockGitResults({
      remote: { stdout: 'origin\thttps://codehub.devcloud.cn-north-4.huaweicloud.com/624d3c360116457693776843c45328a9/dsh-quant.git (fetch)\norigin\thttps://codehub.devcloud.cn-north-4.huaweicloud.com/624d3c360116457693776843c45328a9/dsh-quant.git (push)' },
    });
    // per-project 查询（入参项目 aef718e1...）→ 命中同名仓库 dsh-quant（场景：existing）
    mockCall
      .mockResolvedValueOnce({
        result: {
          total: 1,
          repositorys: [{ id: 'repo-uuid-1', repoId: '777', name: 'dsh-quant', projectId: 'aef718e1ac5f4bed9d74092b3ea582ca' }],
        },
        status: 'success',
      })
      .mockResolvedValueOnce({
        result: { id: 'repo-uuid-1', repoId: '777', name: 'dsh-quant', sshUrl: 'git@...:dsh-quant.git', httpUrl: 'https://codehub.../dsh-quant.git', webUrl: 'https://.../777', projectId: 'aef718e1ac5f4bed9d74092b3ea582ca' },
        status: 'success',
      });

    const result = await repoPrepareHandler(makeCtx(), makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.existing_remote).toBe(true);
    expect(data.repo_id).toBe('777');
    // 机制层警告：远端 URL 项目 ≠ 入参 projectUuid
    expect(data.project_mismatch).toBe(true);
    expect(data.remote_project_uuid).toBe('624d3c360116457693776843c45328a9');
    expect(data.mismatch_hint).toContain('624d3c360116457693776843c45328a9');
    expect(data.mismatch_hint).toContain('aef718e1ac5f4bed9d74092b3ea582ca');
    // existing 场景文案：命中同名仓库提示
    expect(data.mismatch_hint).toContain('命中的是入参项目中的同名仓库');
    expect(result.content[0].text).toContain('project_mismatch');
  });

  it('project_mismatch：远端 URL 项目 = 入参 projectUuid → 不附警告（正常一致）', async () => {
    // 远端 URL 项目 = 入参 projectUuid（一致）→ 不应附 project_mismatch
    mockGitResults({
      remote: { stdout: 'origin\thttps://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git (fetch)\norigin\thttps://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git (push)' },
    });
    mockCall
      .mockResolvedValueOnce({
        result: { total: 1, repositorys: [{ id: 'u1', repoId: '888', name: 'demo', projectId: 'aef718e1ac5f4bed9d74092b3ea582ca' }] },
        status: 'success',
      })
      .mockResolvedValueOnce({
        result: { id: 'u1', repoId: '888', name: 'demo', sshUrl: 'git@...:demo.git', httpUrl: 'https://codehub.../demo.git', webUrl: 'https://.../888', projectId: 'aef718e1ac5f4bed9d74092b3ea582ca' },
        status: 'success',
      });

    const result = await repoPrepareHandler(makeCtx(), makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.existing_remote).toBe(true);
    // 一致 → 不附 project_mismatch
    expect(data.project_mismatch).toBeUndefined();
    expect(data.remote_project_uuid).toBeUndefined();
    expect(data.mismatch_hint).toBeUndefined();
    expect(result.content[0].text).not.toContain('project_mismatch');
  });

  it('project_mismatch：SSH 远端 URL 同样解析项目 UUID 并比对', async () => {
    // SSH 格式：git@codehub...:{projectUuid}/{repoName}.git
    mockGitResults({
      remote: { stdout: 'origin\tgit@codehub.devcloud.cn-north-4.huaweicloud.com:624d3c360116457693776843c45328a9/ssh-repo.git (fetch)\norigin\tgit@codehub.devcloud.cn-north-4.huaweicloud.com:624d3c360116457693776843c45328a9/ssh-repo.git (push)' },
    });
    // per-project 查询未命中 → 建仓（场景：created）
    mockCall
      .mockResolvedValueOnce({ result: { total: 0, repositorys: [] }, status: 'success' })
      .mockResolvedValueOnce({ result: { repository_uuid: 'new-ssh-uuid' }, status: 'success' })
      .mockResolvedValueOnce({
        result: { id: 'new-ssh-uuid', repoId: '999', name: 'ssh-repo', sshUrl: 'git@...:ssh-repo.git', httpUrl: 'https://codehub.../ssh-repo.git', webUrl: 'https://.../999', projectId: 'aef718e1ac5f4bed9d74092b3ea582ca' },
        status: 'success',
      });

    const result = await repoPrepareHandler(makeCtx(), makeInput());

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.created_in_target_project).toBe(true);
    expect(data.project_mismatch).toBe(true);
    expect(data.remote_project_uuid).toBe('624d3c360116457693776843c45328a9');
    expect(data.mismatch_hint).toContain('624d3c360116457693776843c45328a9');
    expect(data.mismatch_hint).toContain('aef718e1ac5f4bed9d74092b3ea582ca');
  });

  it('projectUuid 非法（非 32 位）应抛 E_PARAM', async () => {
    const result = await repoPrepareHandler(makeCtx(), makeInput({ projectUuid: 'short' }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('projectUuid');
  });

  it('repoPath 缺失应抛 E_PARAM', async () => {
    const result = await repoPrepareHandler(makeCtx(), makeInput({ repoPath: '' }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
  });

  it('CreateRepository 缺 repository_uuid 应抛 E_API', async () => {
    mockGitResults({ remote: { stdout: '' } });
    mockCall.mockResolvedValueOnce({ result: {}, status: 'success' });

    const result = await repoPrepareHandler(makeCtx(), makeInput());
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_API');
    expect(result.content[0].text).toContain('repository_uuid');
  });

  it('GetRepository 缺 repoId/sshUrl（建仓后初始化超时）应抛 E_API', async () => {
    mockGitResults({ remote: { stdout: '' } });
    mockCall
      .mockResolvedValueOnce({ result: { repository_uuid: 'uuid-1' }, status: 'success' })
      .mockResolvedValue({ result: {}, status: 'success' }); // 10 次回读都缺 repoId/sshUrl

    const result = await repoPrepareHandler(makeCtx(), makeInput());
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_API');
    expect(result.content[0].text).toContain('repoId/sshUrl');
  }, 15_000);

  it('非 git 仓库（remote -v 失败）→ 忽略并走建仓流程', async () => {
    mockGitResults({
      remote: { error: new Error('fatal: not a git repository') },
    });
    mockCall
      .mockResolvedValueOnce({ result: { repository_uuid: 'uuid-2' }, status: 'success' })
      .mockResolvedValueOnce({
        result: {
          id: 'uuid-2',
          repoId: '1001',
          name: 'demo-repo',
          sshUrl: 'git@codehub...:grp/demo-repo.git',
          httpUrl: 'https://codehub.../grp/demo-repo.git',
          webUrl: 'https://.../codehub/1001',
          groupName: 'grp',
          projectId: 'aef718e1ac5f4bed9d74092b3ea582ca',
        },
        status: 'success',
      });

    const result = await repoPrepareHandler(makeCtx(), makeInput());
    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.repo_id).toBe('1001');
    expect(data.remote_url).toContain('https://');
    // 返回文本含推送指引
    expect(result.content[0].text).toContain('git remote add origin');
  });
});
