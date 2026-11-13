/**
 * dsh 适配层（toDshTool）单测（Layer 1，mock handler，不需网络）
 * 验证 dsh 契约适配行为（2026-10-09）：
 *   - 成功：execute 只返回 JSON 值，人类可读 summary 从 handler content 合并进 data._summary
 *     （dsh 模型只见 output.render(value)，content 通道被丢弃——见 dsh-adapter.ts 头部注释）
 *   - 失败：isError=true → execute 抛 Error（错误文本取自 content）
 *   - local 工具：handler 无 ctx 直接调用
 */
import { describe, it, expect, vi } from 'vitest';
import { toDshTool, type InternalToolDef } from '../src/tools/dsh-adapter.js';
import { buildTools } from '../src/tools/index.js';

/** 构造一个直接返回可观测 handler 的 InternalToolDef */
function makeDef(handler: InternalToolDef['handler'], local = false): InternalToolDef {
  return { name: 'test_tool', description: 'test', parameters: {}, handler, local };
}

describe('toDshTool 适配层', () => {
  it('成功：execute 返回 data，并合并 handler 的 content summary 为 _summary（dsh 只见 render(value)）', async () => {
    const def = makeDef(async () => ({
      isError: false,
      data: { repository_uuid: 'u1', repo_id: '777', existing_remote: true },
      content: [{ type: 'text', text: '仓库 demo 已在目标项目中存在（远端 https://...）。create_job.scms 可用: ...' }],
    }));
    const tool = toDshTool(def);
    const value = await (tool.execute as (args: unknown) => Promise<unknown>)({});

    expect(value).toEqual({
      repository_uuid: 'u1',
      repo_id: '777',
      existing_remote: true,
      _summary: '仓库 demo 已在目标项目中存在（远端 https://...）。create_job.scms 可用: ...',
    });
  });

  it('成功且无 summary：不注入 _summary 键', async () => {
    const def = makeDef(async () => ({
      isError: false,
      data: { ok: true },
      content: [], // handler 未提供人类可读 summary
    }));
    const tool = toDshTool(def);
    const value = await (tool.execute as (args: unknown) => Promise<unknown>)({});

    expect(value).toEqual({ ok: true });
    expect('_summary' in (value as Record<string, unknown>)).toBe(false);
  });

  it('失败：execute 抛 Error（文本取自 handler content，供模型看到错误）', async () => {
    const def = makeDef(async () => ({
      isError: true,
      content: [{ type: 'text', text: '[E_API] CreateRepository 成功但响应缺 result.repository_uuid' }],
    }));
    const tool = toDshTool(def);

    await expect((tool.execute as (args: unknown) => Promise<unknown>)({})).rejects.toThrow('E_API');
  });

  it('local 工具：handler 无 ctx 直接调用（不触 getContext）', async () => {
    const spy = vi.fn(async () => ({ isError: false, data: { status: 'SUCCESS' } }));
    const def = makeDef(spy as InternalToolDef['handler'], true);
    const tool = toDshTool(def);
    const value = await (tool.execute as (args: unknown) => Promise<unknown>)({ cmd: 'build' });

    expect(spy).toHaveBeenCalledWith({ cmd: 'build' }); // 只传 input，无 ctx
    expect(value).toEqual({ status: 'SUCCESS' });
  });

  // ─── 注册形态回归：repo_push / get_push_credential 必须为 local（无 ctx），否则 execute 会把 ctx 当 input 传入 ───
  // 工具构成（18）= 16 云工具（含 repo_prepare）+ 2 个 local（repo_push + get_push_credential）
  // repo_build 已于 2026-11-06 废弃删除（FE-14 废弃决策执行，工具数 19→18）
  it('buildTools：codeartsbuild_repo_push 已注册且总数 18（注册级健全性）', () => {
    const tools = buildTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('codeartsbuild_repo_push');
    expect(names).toContain('codeartsbuild_repo_prepare');
    expect(tools.length).toBe(18);
    // 参数 schema 含 repoPath/projectUuid（注册级——defineTool 会把 parameters 转为 JSON Schema）
    const push = tools.find((t) => t.name === 'codeartsbuild_repo_push') as unknown as {
      parameters?: { properties?: Record<string, unknown> } | Record<string, unknown>;
    };
    const params = (push?.parameters ?? {}) as Record<string, unknown>;
    const properties = (params.properties ?? params) as Record<string, unknown>;
    expect(properties.repoPath).toBeTruthy();
    expect(properties.projectUuid).toBeTruthy();
  });

  // ─── 2026-10-28 注册级健全性：get_push_credential 已注册、parameters 含 remoteUrl（必填） ───
  it('buildTools：codeartsbuild_get_push_credential 已注册且 parameters 含必填 remoteUrl', () => {
    const tools = buildTools();
    expect(tools.map((t) => t.name)).toContain('codeartsbuild_get_push_credential');

    const cred = tools.find((t) => t.name === 'codeartsbuild_get_push_credential') as unknown as {
      parameters?: { properties?: Record<string, unknown>; required?: unknown[] } | Record<string, unknown>;
    };
    const params = (cred?.parameters ?? {}) as Record<string, unknown>;
    const properties = (params.properties ?? params) as Record<string, unknown>;
    // remoteUrl 必填（构造 authedUrl 的唯一必需入参）
    expect(properties.remoteUrl).toBeTruthy();
    expect((properties.remoteUrl as { type?: string }).type).toBe('string');
    // required 声明在根级 schema 上（defineTool 编译为隐式 open object 根）
    expect(params.required).toEqual(expect.arrayContaining(['remoteUrl']));
    // accessToken 为可选入参（不进入 required）
    expect(properties.accessToken).toBeTruthy();
    expect(params.required as string[]).not.toContain('accessToken');
  });

  // ─── local 形态端到端：get_push_credential 传合法 input 不被 ctx 覆盖 ───
  it('buildTools：get_push_credential execute 传合法 input 不被 ctx 覆盖（local 形态端到端）', async () => {
    // 若被当 cloud 工具注册，execute 会把 getContext()（含 client 的对象）当第一个参数传入，
    // handler 收到的 input.remoteUrl 为 undefined → 返回 missing_remote_url；
    // local 修复后 execute 直接调 handler(input) → 走通 token 解析与 authedUrl 构造。
    const tools = buildTools();
    const cred = tools.find((t) => t.name === 'codeartsbuild_get_push_credential') as unknown as {
      execute: (args: unknown) => Promise<unknown>;
    };
    const remoteUrl = 'https://codehub.devcloud.cn-north-4.huaweicloud.com/d9ef97fa845d412687496770dd9f45ae/demo.git';
    const result = await cred.execute({ remoteUrl, accessToken: 'EXPLICIT_TOKEN_for_adapter' });
    const data = result as { available?: boolean; reason?: string; username?: string; authed_url?: string };

    expect(data.available).toBe(true);
    expect(data.reason).toBeUndefined();
    expect(data.username).toBe('private-token');
    expect(data.authed_url).toContain('https://private-token:EXPLICIT_TOKEN_for_adapter@codehub.devcloud.cn-north-4.huaweicloud.com');
  });

  it('buildTools：repo_push execute 传合法 input 不被 ctx 覆盖（local 形态端到端）', async () => {
    // 若 repo_push 被当 cloud 工具注册，execute 会把 getContext()（含 client 的对象）当第一个参数传入，
    // 导致 handler 收到 {client, session, envProjectId} 而非 {repoPath, projectUuid} → repoPath 必填。
    // local 修复后，execute 直接调 handler(input)，repoPath 校验应通过并进入后续逻辑。
    const tools = buildTools();
    const push = tools.find((t) => t.name === 'codeartsbuild_repo_push') as unknown as {
      execute: (args: unknown) => Promise<unknown>;
    };
    // 传入缺 remoteUrl 的合法 input：local 分支 → handler 先过非 git 仓库预检（FE-13 §2.2，
    // D:/tmp/nonexist-repo 不存在 .git → not_git_repo）；若被当 cloud（ctx 注入），会抛 repoPath 必填（E_PARAM）。
    const result = await push.execute({
      repoPath: 'D:/tmp/nonexist-repo',
      projectUuid: 'aef718e1ac5f4bed9d74092b3ea582ca',
    });
    const data = result as { pushed?: boolean; reason?: string };
    expect(data.pushed).toBe(false);
    expect(data.reason).toBe('not_git_repo');
  });
});
