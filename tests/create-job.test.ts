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

beforeEach(() => {
  mockCall.mockReset();
  mockCall.mockResolvedValue({ result: { job_id: 'job-123' } });
});

describe('createJobHandler', () => {
  it('成功：返回 job_id + created，且更新会话 projectId', async () => {
    const session = {};
    const ctx = makeCtx({ session });

    const result = await createJobHandler(ctx, makeInput());

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('jobId=job-123');
    expect(mockCall).toHaveBeenCalledTimes(1);
    // call 入参：POST /v1/job/create + 完整 body
    const [req] = mockCall.mock.calls[0];
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/v1/job/create');
    expect(req.body.job_name).toBe('test-job');
    expect(req.body.project_id).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(session).toHaveProperty('projectId', 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
  });

  it('成功：description 字段直传（不丢失）', async () => {
    const ctx = makeCtx({});

    await createJobHandler(ctx, makeInput({ description: '任务描述', agencyUrn: 'urn:agency' }));

    const [req] = mockCall.mock.calls[0];
    expect(req.body.description).toBe('任务描述');
    expect(req.body.agency_urn).toBe('urn:agency');
  });

  it('jobName 空串应抛 E_PARAM', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(ctx, makeInput({ jobName: '' }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(mockCall).not.toHaveBeenCalled();
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
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('projectId 缺省但有会话值应复用会话', async () => {
    const session = { projectId: 'session-project-1' };
    const ctx = makeCtx({ session });

    await createJobHandler(ctx, makeInput({ projectId: undefined }));

    const [req] = mockCall.mock.calls[0];
    expect(req.body.project_id).toBe('session-project-1');
  });

  it('响应缺 result.job_id 应抛 E_API', async () => {
    mockCall.mockResolvedValue({ status: 'success' });
    const ctx = makeCtx({});

    const result = await createJobHandler(ctx, makeInput());

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_API');
  });

  it('client.call 抛 ToolException 应透传错误码', async () => {
    mockCall.mockRejectedValue(new ToolException('E_AUTH', '认证失败', {}));
    const ctx = makeCtx({});

    const result = await createJobHandler(ctx, makeInput());

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_AUTH');
  });

  it('client.call 抛非 ToolException 应映射 E_API', async () => {
    mockCall.mockRejectedValue(new Error('boom'));
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
    expect(mockCall).not.toHaveBeenCalled();
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
    expect(mockCall).not.toHaveBeenCalled();
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
    expect(mockCall).not.toHaveBeenCalled();
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
    expect(mockCall).not.toHaveBeenCalled();
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
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('合法 codehub scm 透传且请求体为 snake_case 字段', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({
        scms: [{ scm_type: 'codehub', repo_id: 'repo-123', repo_name: 'demo', branch: 'master', url: 'git@codehub...' }],
      }),
    );

    expect(mockCall).toHaveBeenCalledTimes(1);
    const [req] = mockCall.mock.calls[0];
    expect(req.body.scms).toEqual([
      { scm_type: 'codehub', repo_id: 'repo-123', repo_name: 'demo', branch: 'master', url: 'git@codehub...', web_url: undefined, build_type: undefined, build_commit_id: undefined, build_tag: undefined },
    ]);
  });

  it('camelCase scm 入参（scmType/repoId）映射为 snake_case 请求体', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({ scms: [{ scmType: 'codehub', repoId: 'repo-456', repoName: 'demo2' }] }),
    );

    expect(mockCall).toHaveBeenCalledTimes(1);
    const [req] = mockCall.mock.calls[0];
    expect(req.body.scms[0].scm_type).toBe('codehub');
    expect(req.body.scms[0].repo_id).toBe('repo-456');
    expect(req.body.scms[0].repo_name).toBe('demo2');
  });

  it('422 仓库不存在错误应增强回溯提示（不返回原始 E_PARAM 裸信息）', async () => {
    mockCall.mockRejectedValue(
      new ToolException('E_PARAM', '参数错误（422）: 仓库不存在或仓库已被删除', { httpStatusCode: 422 }),
    );
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

    expect(mockCall).toHaveBeenCalledTimes(1);
    const [req] = mockCall.mock.calls[0];
    expect(req.body.scms).toBeUndefined();
  });

  it('flavor 缺省默认 DEFAULT（2026-09-29 优化）', async () => {
    const ctx = makeCtx({});
    await createJobHandler(ctx, makeInput({ flavor: undefined }));

    const [req] = mockCall.mock.calls[0];
    expect(req.body.flavor).toBe('DEFAULT');
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

    expect(mockCall).toHaveBeenCalledTimes(1);
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
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('stepsPlan 用合法 template_id 正常放行', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({ stepsPlan: [{ step: 'npm-build', properties: { command: 'npm install && npm run build' } }] }),
    );

    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it('stepsPlan 用全限定 module_id（白名单内）正常放行', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({ stepsPlan: [{ step: 'devcloud2018.codeci_action_20014.action' }] }),
    );

    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it('groupId 臆造（非空）应抛 E_PARAM 提示来源', async () => {
    const ctx = makeCtx({});
    const result = await createJobHandler(ctx, makeInput({ groupId: 'dsh-quant-group' }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(result.content[0].text).toContain('臆造');
    expect(result.content[0].text).toContain('get_job');
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('groupId 为空/缺省正常放行', async () => {
    const ctx = makeCtx({});
    await createJobHandler(ctx, makeInput({ groupId: undefined }));

    expect(mockCall).toHaveBeenCalledTimes(1);
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
    expect(mockCall).not.toHaveBeenCalled();
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

    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it('scms[].url 不可解析（非 codehub 格式）正常放行', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({
        scms: [{ scm_type: 'codehub', repo_id: 'repo-1', url: 'git@codehub:unknown-host:repo.git' }],
      }),
    );

    expect(mockCall).toHaveBeenCalledTimes(1);
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
    expect(mockCall).not.toHaveBeenCalled();
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
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('steps 覆盖 image_select 内的合法镜像（nodejs20）正常放行', async () => {
    const ctx = makeCtx({});
    await createJobHandler(
      ctx,
      makeInput({
        steps: [{ module_id: 'devcloud2018.codeci_action_20014.action', name: 'Npm构建', properties: { image: 'nodejs20' } }],
      }),
    );

    expect(mockCall).toHaveBeenCalledTimes(1);
  });
});
