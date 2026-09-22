/**
 * create-job handler 单测（Layer 1，mock HttpClient，不需网络）
 * 对齐 api-contract.md §2.4 + tool-details.md §3.5
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
});
