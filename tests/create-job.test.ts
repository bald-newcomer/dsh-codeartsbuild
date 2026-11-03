/**
 * create-job handler 单测（Layer 1，mock HttpClient，不需网络）
 * 对齐 api-contract.md §2.4 + FE-03-工具详细设计-20260918.md §3.5
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createJobHandler, type CreateJobHandlerInput } from '../src/providers/codeartsbuild/create-job.js';
import { ToolException } from '../src/core/types.js';

/** mock HttpClient（注入 call） */
const mockCall = vi.fn();

const fakeClient = {
  call: mockCall,
} as never;

/** 合法 steps（白名单 module_id） */
const VALID_STEPS = [
  { module_id: 'devcloud2018.codeci_action_20043.action', name: 'Maven构建', enable: true },
];

function makeCtx(overrides?: { session?: { projectId?: string }; envProjectId?: string }) {
  return {
    client: fakeClient,
    session: overrides?.session ?? {},
    envProjectId: overrides?.envProjectId,
  };
}

function makeInput(overrides?: Partial<CreateJobHandlerInput>): CreateJobHandlerInput {
  return {
    jobName: 'test-job',
    arch: 'x86-64',
    projectId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    steps: VALID_STEPS,
    ...overrides,
  };
}

/** 提取 POST /v1/job/create 调用（查重 GET /v1/job/list 在前，不能假设 calls[0]） */
function getCreateCall(): { method: string; path: string; body?: Record<string, unknown> } {
  const call = mockCall.mock.calls.find((c) => c[0]?.method === 'POST' && c[0]?.path === '/v1/job/create');
  return (call ?? [])[0] as { method: string; path: string; body?: Record<string, unknown> };
}

/** 是否发起了 create 调用 */
function createCalled(): boolean {
  return mockCall.mock.calls.some((c) => c[0]?.method === 'POST' && c[0]?.path === '/v1/job/create');
}

beforeEach(() => {
  mockCall.mockReset();
  // FE-15 查重（#10）：GET /v1/job/list 返回空列表（不命中同名），POST /v1/job/create 返回 job_id
  mockCall.mockImplementation((req: { method: string; path: string }) => {
    if (req.method === 'GET' && req.path === '/v1/job/list') {
      return Promise.resolve({ result: { total: 0, job_list: [] } });
    }
    return Promise.resolve({ result: { job_id: 'job-123' } });
  });
});

describe('createJobHandler', () => {
  it('成功：返回 job_id + created，且更新会话 projectId', async () => {
    const session = {};
    const ctx = makeCtx({ session });

    const result = await createJobHandler(ctx, makeInput());

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('jobId=job-123');
    expect(createCalled()).toBe(true);
    // call 入参：POST /v1/job/create + 完整 body（查重 GET 在前，用 getCreateCall 定位）
    const req = getCreateCall();
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/v1/job/create');
    expect(req.body?.job_name).toBe('test-job');
    expect(req.body?.project_id).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(session).toHaveProperty('projectId', 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
  });

  it('成功：description 字段直传（不丢失）', async () => {
    const ctx = makeCtx({});

    await createJobHandler(ctx, makeInput({ description: '任务描述', agencyUrn: 'urn:agency' }));

    const req = getCreateCall();
    expect(req.body?.description).toBe('任务描述');
    expect(req.body?.agency_urn).toBe('urn:agency');
  });

  it('jobName 空串应抛 E_PARAM', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(ctx, makeInput({ jobName: '' }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(createCalled()).toBe(false);
  });

  it('jobName 超 115 字符应抛 E_PARAM', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(ctx, makeInput({ jobName: 'x'.repeat(116) }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
  });

  it('projectId 缺省且无 session/env 应抛 E_PARAM', async () => {
    const ctx = makeCtx({ session: {}, envProjectId: undefined });
    const result = await createJobHandler(ctx, makeInput({ projectId: undefined }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(createCalled()).toBe(false);
  });

  it('projectId 缺省但有会话值应复用会话', async () => {
    const session = { projectId: 'session-project-1' };
    const ctx = makeCtx({ session });

    await createJobHandler(ctx, makeInput({ projectId: undefined }));

    const req = getCreateCall();
    expect(req.body?.project_id).toBe('session-project-1');
  });

  it('响应缺 result.job_id 应抛 E_API', async () => {
    mockCall.mockImplementation((req: { method: string; path: string }) => {
      if (req.method === 'GET' && req.path === '/v1/job/list') return Promise.resolve({ result: { total: 0, job_list: [] } });
      return Promise.resolve({ status: 'success' });
    });
    const ctx = makeCtx({});

    const result = await createJobHandler(ctx, makeInput());

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_API');
  });

  it('client.call 抛 ToolException 应透传错误码', async () => {
    mockCall.mockImplementation((req: { method: string; path: string }) => {
      if (req.method === 'GET' && req.path === '/v1/job/list') return Promise.resolve({ result: { total: 0, job_list: [] } });
      return Promise.reject(new ToolException('E_AUTH', '认证失败', {}));
    });
    const ctx = makeCtx({});

    const result = await createJobHandler(ctx, makeInput());

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_AUTH');
  });

  it('client.call 抛非 ToolException 应映射 E_API', async () => {
    mockCall.mockImplementation((req: { method: string; path: string }) => {
      if (req.method === 'GET' && req.path === '/v1/job/list') return Promise.resolve({ result: { total: 0, job_list: [] } });
      return Promise.reject(new Error('boom'));
    });
    const ctx = makeCtx({});

    const result = await createJobHandler(ctx, makeInput());

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_API');
  });

  it('非法 module_id（非白名单）应抛 E_PARAM', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(
      ctx,
      makeInput({ steps: [{ module_id: 'devcloud2018.codeci_action_99999.action', name: 'fake' }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(createCalled()).toBe(false);
  });

  // ─── FE-07 O5：scm 字段来源校验 ───

  it('scm 缺 scm_type 应抛 E_PARAM（禁止臆造）', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(
      ctx,
      makeInput({ scms: [{ repo_id: 'repo-1' }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('scm_type');
    expect(createCalled()).toBe(false);
  });

  it('scm_type 非 codehub（gitlab/github 臆造）应抛 E_PARAM', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(
      ctx,
      makeInput({ scms: [{ scm_type: 'gitlab', repo_id: 'repo-1' }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('gitlab');
    expect(createCalled()).toBe(false);
  });

  it('scm 缺 repo_id 应抛 E_PARAM（来源渠道提示）', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(
      ctx,
      makeInput({ scms: [{ scm_type: 'codehub' }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('repo_id');
    expect(createCalled()).toBe(false);
  });

  it('scm url 为第三方 Git 平台（github.com）应抛 E_PARAM', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(
      ctx,
      makeInput({ scms: [{ scm_type: 'codehub', repo_id: 'repo-1', url: 'https://github.com/x/y.git' }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('github.com');
    expect(createCalled()).toBe(false);
  });

  it('合法 codehub scm 透传且请求体为 snake_case 字段', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({
        scms: [{ scm_type: 'codehub', repo_id: 'repo-123', repo_name: 'demo', branch: 'master', url: 'git@codehub...' }],
      }),
    );

    expect(createCalled()).toBe(true);
    const req = getCreateCall();
    expect(req.body?.scms).toEqual([
      { scm_type: 'codehub', repo_id: 'repo-123', repo_name: 'demo', branch: 'master', url: 'git@codehub...', web_url: undefined, build_type: undefined, build_commit_id: undefined, build_tag: undefined },
    ]);
  });

  it('camelCase scm 入参（scmType/repoId）映射为 snake_case 请求体', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({ scms: [{ scmType: 'codehub', repoId: 'repo-456', repoName: 'demo2' }] }),
    );

    expect(createCalled()).toBe(true);
    const req = getCreateCall();
    expect(req.body?.scms[0].scm_type).toBe('codehub');
    expect(req.body?.scms[0].repo_id).toBe('repo-456');
    expect(req.body?.scms[0].repo_name).toBe('demo2');
  });

  it('422 仓库不存在错误应增强回溯提示（不返回原始 E_PARAM 裸信息）', async () => {
    mockCall.mockImplementation((req: { method: string; path: string }) => {
      if (req.method === 'GET' && req.path === '/v1/job/list') return Promise.resolve({ result: { total: 0, job_list: [] } });
      return Promise.reject(new ToolException('E_PARAM', '参数错误（422）: 仓库不存在或仓库已被删除', { httpStatusCode: 422 }));
    });
    const ctx = makeCtx({});
    const result = await createJobHandler(
      ctx,
      makeInput({ scms: [{ scm_type: 'codehub', repo_id: 'repo-gone' }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('仓库不存在');
    expect(result.content[0].text).toContain('回溯 scm 来源渠道');
    expect(result.content[0].text).toContain('禁止臆造');
  });

  it('无 scms 时正常透传（不校验）', async () => {
    const ctx = makeCtx({});
    await createJobHandler(ctx, makeInput({ scms: undefined }));

    expect(createCalled()).toBe(true);
    const req = getCreateCall();
    expect(req.body?.scms).toBeUndefined();
  });

  it('FE-13: 无 scms 成功返回附 scms_empty_hint，含 repo_prepare→repo_push 操作路径引导', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(ctx, makeInput({ scms: undefined, projectId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }));

    expect(result.isError).toBe(false);
    const data = result.data as { scms_empty_hint?: string };
    expect(data.scms_empty_hint).toContain('任务无代码源');
    expect(data.scms_empty_hint).toContain('repo_prepare');
    expect(data.scms_empty_hint).toContain('repo_push');
    expect(data.scms_empty_hint).toContain('update_job');
  });

  it('flavor 缺省默认 DEFAULT（2026-09-29 优化）', async () => {
    const ctx = makeCtx({});
    await createJobHandler(ctx, makeInput({ flavor: undefined }));

    const req = getCreateCall();
    expect(req.body?.flavor).toBe('DEFAULT');
  });

  it('flavor 非法（臆造值）应抛 E_PARAM（仅 DEFAULT 合法）', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(ctx, makeInput({ flavor: '16cpu64g' }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('flavor');
  });

  it('jobName 含非法字符（空格/特殊符号）应抛 E_PARAM（仅中英文/数字/_/-）', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(ctx, makeInput({ jobName: 'my build task!' }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('字符集');
  });

  it('jobName 中文/下划线/连字符合法（不抛错）', async () => {
    const ctx = makeCtx({});
    await createJobHandler(ctx, makeInput({ jobName: '中文任务-构建_v2' }));

    expect(createCalled()).toBe(true);
  });

  // ─── 2026-10-10：stepsPlan 裸 module_id 前置引导 / groupId 臆造防御 / scms URL 项目一致性 ───

  it('stepsPlan 臆造裸 module_id 应抛 E_PARAM 并列出可用 template_id', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(
      ctx,
      makeInput({ stepsPlan: [{ step: 'devcloud2018.codeci_action_20040', properties: { command: 'npm install' } }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('未匹配模板');
    expect(result.content[0].text).toContain('template_id');
    expect(result.content[0].text).toContain('npm-build');
    expect(createCalled()).toBe(false);
  });

  it('stepsPlan 用合法 template_id 正常放行', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({ stepsPlan: [{ step: 'npm-build', properties: { command: 'npm install && npm run build' } }] }),
    );

    expect(createCalled()).toBe(true);
  });

  it('stepsPlan 用全限定 module_id（白名单内）正常放行', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({ stepsPlan: [{ step: 'devcloud2018.codeci_action_20014.action' }] }),
    );

    expect(createCalled()).toBe(true);
  });

  it('groupId 臆造（非空）应抛 E_PARAM 提示来源', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(ctx, makeInput({ groupId: 'dsh-quant-group' }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('臆造');
    expect(result.content[0].text).toContain('get_job');
    expect(createCalled()).toBe(false);
  });

  it('groupId 为空/缺省正常放行', async () => {
    const ctx = makeCtx({});
    await createJobHandler(ctx, makeInput({ groupId: undefined }));

    expect(createCalled()).toBe(true);
  });

  it('scms[].url 项目 UUID 与会话 projectId 不一致应抛 E_PARAM（禁止跨项目）', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(
      ctx,
      makeInput({
        scms: [{
          scm_type: 'codehub',
          repo_id: 'repo-1',
          url: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/99999999999999999999999999999999/dsh-quant.git',
        }],
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('不一致');
    expect(result.content[0].text).toContain('99999999999999999999999999999999');
    expect(createCalled()).toBe(false);
  });

  it('scms[].url 项目 UUID 与会话 projectId 一致正常放行', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({
        scms: [{
          scm_type: 'codehub',
          repo_id: 'repo-1',
          url: 'https://codehub.devcloud.cn-north-4.huaweicloud.com/a1b2c3d4e5f60718293a4b5c6d7e8f90/demo.git',
        }],
      }),
    );

    expect(createCalled()).toBe(true);
  });

  it('scms[].url 不可解析（非 codehub 格式）正常放行', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({
        scms: [{ scm_type: 'codehub', repo_id: 'repo-1', url: 'git@codehub:unknown-host:repo.git' }],
      }),
    );

    expect(createCalled()).toBe(true);
  });

  // ─── 2026-10-10（FE-11 延伸）：image 臆造拦截（c6ca1e11 会话 nodejs18.0.0 等 6 轮空转）───

  it('steps 覆盖臆造 image（nodejs18.0.0）应抛 E_PARAM 列可用镜像', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(
      ctx,
      makeInput({
        steps: [{ module_id: 'devcloud2018.codeci_action_20014.action', name: 'Npm构建', properties: { image: 'nodejs18.0.0' } }],
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('不在可用镜像列表');
    expect(result.content[0].text).toContain('nodejs20');
    expect(createCalled()).toBe(false);
  });

  it('stepsPlan 覆盖臆造 image 应抛 E_PARAM（不触发 HTTP）', async () => {
    const ctx = makeCtx({});
    // makeInput 默认含显式 steps（最高优先）——清掉 steps 让 stepsPlan 生效
    const result = await createJobHandler(
      ctx,
      makeInput({ steps: undefined, stepsPlan: [{ step: 'npm-build', properties: { image: 'nodejs99' } }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('不在可用镜像列表');
    expect(createCalled()).toBe(false);
  });

  it('steps 覆盖 image_select 内的合法镜像（nodejs20）正常放行', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({
        steps: [{ module_id: 'devcloud2018.codeci_action_20014.action', name: 'Npm构建', properties: { image: 'nodejs20' } }],
        imageSource: 'list_templates', // FE-16 §2.2：声明 image 来源
      }),
    );

    expect(createCalled()).toBe(true);
  });

  // ─── FE-15 §4 #10：任务名查重机制化 ───

  it('FE-15: 查重命中同名任务 → E_PARAM 引导复用/改名/update_job，不创建', async () => {
    mockCall.mockImplementation((req: { method: string; path: string }) => {
      if (req.method === 'GET' && req.path === '/v1/job/list') {
        return Promise.resolve({ result: { total: 1, job_list: [{ id: 'existing-job', job_name: 'test-job' }] } });
      }
      return Promise.resolve({ result: { job_id: 'job-123' } });
    });
    const ctx = makeCtx({});

    const result = await createJobHandler(ctx, makeInput());

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('已存在同名构建任务');
    expect(result.content[0].text).toContain('update_job');
    expect(createCalled()).toBe(false);
  });

  it('FE-15: 查重失败（接口错误）→ 不阻断，继续创建（服务端 422 兜底）', async () => {
    mockCall.mockImplementation((req: { method: string; path: string }) => {
      if (req.method === 'GET' && req.path === '/v1/job/list') {
        return Promise.reject(new Error('network down'));
      }
      return Promise.resolve({ result: { job_id: 'job-456' } });
    });
    const ctx = makeCtx({});

    const result = await createJobHandler(ctx, makeInput());

    expect(result.isError).toBe(false);
    expect(createCalled()).toBe(true);
  });

  // ─── FE-16 §2.2：image 字面量来源软引导（2026-11-03 会话 e3c9f738）───

  it('FE-16: steps 覆盖 image 但未传 imageSource → need_image_source 警告，不创建', async () => {
    // 会话证据：模型传 image: "shell4.2.46-git1.8.3-zip6.00" 虽合法但未从 list_templates/get_job 验证
    // FE-16 §2.2：未传 imageSource + image 被覆盖 → need_image_source 警告（不创建）
    const ctx = makeCtx({});
    const result = await createJobHandler(
      ctx,
      makeInput({
        steps: [{ module_id: 'devcloud2018.codeci_action_20014.action', name: 'Npm构建', properties: { image: 'nodejs20' } }],
        // 未传 imageSource
      }),
    );

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.created).toBe(false);
    expect(data.need_image_source).toBe(true);
    const actions = data.next_actions as string[];
    expect(actions.some((a) => a.includes('list_templates'))).toBe(true);
    expect(actions.some((a) => a.includes('manual'))).toBe(true);
    // 不触发 HTTP create
    expect(createCalled()).toBe(false);
  });

  it('FE-16: 传 imageSource: list_templates + image 覆盖 → 正常创建', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({
        steps: [{ module_id: 'devcloud2018.codeci_action_20014.action', name: 'Npm构建', properties: { image: 'nodejs20' } }],
        imageSource: 'list_templates',
      }),
    );

    expect(createCalled()).toBe(true);
  });

  it('FE-16: 传 imageSource: manual + image 覆盖 → 正常创建（降级路径）', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({
        steps: [{ module_id: 'devcloud2018.codeci_action_20014.action', name: 'Npm构建', properties: { image: 'nodejs20' } }],
        imageSource: 'manual',
      }),
    );

    expect(createCalled()).toBe(true);
  });

  it('FE-16: 未传 imageSource + steps 无 image 覆盖（用默认值）→ 正常创建（不拦）', async () => {
    // properties 无 image 字段 → 用模板默认值，不触发 imageSource 软引导
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({
        steps: [{ module_id: 'devcloud2018.codeci_action_20014.action', name: 'Npm构建', properties: { command: 'npm run build' } }],
        // 未传 imageSource，但无 image 覆盖
      }),
    );

    expect(createCalled()).toBe(true);
  });

  it('FE-16: 未传 imageSource + stepsPlan 覆盖 image → need_image_source 警告', async () => {
    // stepsPlan 组装后 steps 含 image 覆盖 → 同样触发 imageSource 软引导
    // 注意：makeInput 默认含 steps: VALID_STEPS，须显式置 undefined 走 stepsPlan 路径
    const ctx = makeCtx({});
    const result = await createJobHandler(
      ctx,
      makeInput({
        steps: undefined,
        stepsPlan: [{ step: 'npm-build', properties: { image: 'nodejs20' } }],
        // 未传 imageSource
      }),
    );

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.need_image_source).toBe(true);
    expect(createCalled()).toBe(false);
  });
});
