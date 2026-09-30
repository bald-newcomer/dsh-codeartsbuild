/**
 * wait_build / get_log handler + log-cleaner / zip 单测（Layer 1，mock HttpClient，不需网络）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolException } from '../src/core/types.js';
import { cleanLog } from '../src/infra/log-cleaner.js';
import { extractLogText } from '../src/infra/zip.js';
import type { HttpClient } from '../src/infra/http-client.js';
import { waitBuildHandler } from '../src/providers/codeartsbuild/wait-build.js';
import { getLogHandler } from '../src/providers/codeartsbuild/get-log.js';
import AdmZip from 'adm-zip';

function makeClient(handler: (req: unknown) => unknown) {
  return { call: vi.fn(handler) } as unknown as HttpClient;
}

function makeCtx(client: HttpClient) {
  return { client, session: {}, envProjectId: undefined };
}

// ─── wait_build ───
describe('waitBuildHandler', () => {

  it('终态立即返回（completed→SUCCESS）', async () => {
    const client = makeClient(() => ({ result: { workflow: { status: 'completed' } } }));
    const result = await waitBuildHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      buildNo: 1,
      intervalMs: 2000,
      timeoutMs: 60000,
    });

    expect(result.isError).toBe(false);
    expect((result.data as { status: string }).status).toBe('SUCCESS');
    expect(client.call).toHaveBeenCalledTimes(1);
    const [req] = client.call.mock.calls[0] as [{ path: string; query: Record<string, unknown> }];
    expect(req.path).toBe('/v1/job/job-1/status');
    expect(req.query.build_no).toBe(1);
  });

  it('completed+error→record-info 复核 FAILED 则 FAILED', async () => {
    // step-status: completed+error（非取消类）→ 复核 record-info=FAILED → 判 FAILED
    const calls = [
      { result: { workflow: { status: 'completed', error: { code: 'DEV.CB.0100', reason: '构建失败' } } } },
      { result: { status: 'FAILED' } }, // record-info 复核
    ];
    let i = 0;
    const client = makeClient(() => calls[i++]);
    const result = await waitBuildHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      buildNo: 1,
      intervalMs: 2000,
      timeoutMs: 60000,
    });
    expect((result.data as { status: string }).status).toBe('FAILED');
  });

  it('completed+error但record-info=SUCCESS→SUCCESS（实测 2026-09-21：error 瞬态，日志 SUCCESS）', async () => {
    // step-status: completed+error（非取消类）→ 复核 record-info=SUCCESS → 判 SUCCESS（修正误判 FAILED）
    const calls = [
      { result: { workflow: { status: 'completed', error: { code: 'X.001', reason: '瞬态' } } } },
      { result: { status: 'SUCCESS' } }, // record-info 复核为成功
    ];
    let i = 0;
    const client = makeClient(() => calls[i++]);
    const result = await waitBuildHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      buildNo: 1,
      intervalMs: 2000,
      timeoutMs: 60000,
    });
    expect((result.data as { status: string }).status).toBe('SUCCESS');
  });

  it('completed+取消类error→CANCELED（实测 2026-09-21：stop 后 error=COCT.0020003.450 用户取消任务执行）', async () => {
    const client = makeClient(() => ({
      result: { workflow: { status: 'completed', error: { code: 'COCT.0020003.450', reason: '用户取消任务执行' } } },
    }));
    const result = await waitBuildHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      buildNo: 1,
      intervalMs: 2000,
      timeoutMs: 60000,
    });
    expect((result.data as { status: string }).status).toBe('CANCELED');
  });

  it('running→RUNNING 不终态，轮询至 SUCCESS', async () => {
    const calls = [
      { result: { workflow: { status: 'running' } } },
      { result: { workflow: { status: 'completed' } } },
    ];
    let i = 0;
    const client = makeClient(() => calls[i++]);
    const result = await waitBuildHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      buildNo: 1,
      intervalMs: 2000,
      timeoutMs: 60000,
    });

    expect((result.data as { status: string }).status).toBe('SUCCESS');
    expect(client.call).toHaveBeenCalledTimes(2);
  });

  it('超时返回 TIMEOUT + last_status（非异常）', async () => {
    // Date.now spy：首次查询后模拟时间流逝越过 timeoutMs（避免真实等待）
    let calls = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => (calls === 0 ? 0 : 70_000));
    const client = makeClient(() => {
      calls++;
      return { result: { workflow: { status: 'running' } } };
    });
    const result = await waitBuildHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      buildNo: 1,
      intervalMs: 2000,
      timeoutMs: 60_000, // 校验下限 60s；时间流逝由 Date.now 模拟
    });
    nowSpy.mockRestore();

    expect(result.isError).toBe(false);
    const data = result.data as { status: string; last_status: string };
    expect(data.status).toBe('TIMEOUT');
    expect(data.last_status).toBe('RUNNING');
  });

  it('非网络错误（E_AUTH）应透传', async () => {
    const client = makeClient(() => {
      throw new ToolException('E_AUTH', '认证失败');
    });
    const result = await waitBuildHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      buildNo: 1,
      intervalMs: 2000,
      timeoutMs: 60000,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_AUTH');
  });

  it('连续网络失败 3 轮仍失败应抛 E_NETWORK（单轮抖动被吸收）', async () => {
    // fake timers：sleep 被 mock，时间推进由 advanceTimersByTimeAsync 控制
    vi.useFakeTimers();
    const client = makeClient(() => {
      throw new ToolException('E_NETWORK', '连接失败');
    });
    const promise = waitBuildHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      buildNo: 1,
      intervalMs: 2000,
      timeoutMs: 60000,
    });
    // 每轮：内层重试 2 次（各 2s）+ 外层退避 sleep（2s→3s→4.5s）
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(2000 + 2000 + 2000);
    }
    const result = await promise;
    vi.useRealTimers();

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_NETWORK');
    expect(result.content[0].text).toContain('连续网络失败');
  });

  it('单轮网络抖动后恢复应继续轮询（不抛错）', async () => {
    // 第 1 轮网络失败（抖动），后续轮询恢复 running → completed
    vi.useFakeTimers();
    const responses = [
      () => { throw new ToolException('E_NETWORK', '抖动'); },
      () => ({ result: { workflow: { status: 'running' } } }),
      () => ({ result: { workflow: { status: 'completed' } } }),
    ];
    let i = 0;
    const client = makeClient(() => responses[i++]());
    const promise = waitBuildHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      buildNo: 1,
      intervalMs: 2000,
      timeoutMs: 60000,
    });
    // 第 1 轮：内层重试 2 次（各 2s）+ 退避 sleep 2s → 第 2 轮查询
    await vi.advanceTimersByTimeAsync(2000 + 2000 + 2000);
    // 第 2 轮 running → sleep 3s → 第 3 轮 completed 终态
    await vi.advanceTimersByTimeAsync(2000 + 3000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.isError).toBe(false);
    expect((result.data as { status: string }).status).toBe('SUCCESS');
  });

  it('参数校验：intervalMs 越界应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await waitBuildHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      buildNo: 1,
      intervalMs: 100, // < 2000
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
  });
});

// ─── get_log ───
describe('getLogHandler', () => {

  it('成功：rawBinary 下载 + ZIP 解压 + 清洗', async () => {
    // 构造含 message.txt 的最小 ZIP（deflate 压缩 "Finished: FAILURE\n[ERROR] demo"）
        const zip = new AdmZip();
    zip.addFile('message.txt', Buffer.from('[INFO] start\n[ERROR] docker build failed\nFinished: FAILURE\n'));
    const buf = zip.toBuffer();

    const client = makeClient(() => buf);
    const result = await getLogHandler(makeCtx(client) as never, { recordId: '9d6169b9-022d-458c-9dc8-48cc94cc4083' });

    expect(result.isError).toBe(false);
    const data = result.data as { record_id: string; byte_size: number; structured: unknown[]; finished: string };
    expect(data.record_id).toBe('9d6169b9-022d-458c-9dc8-48cc94cc4083');
    expect(data.finished).toBe('FAILURE');
    expect(data.structured.length).toBeGreaterThan(0);
    const [req] = client.call.mock.calls[0] as [{ path: string; query: Record<string, unknown>; opts?: unknown }];
    expect(req.path).toBe('/v1/log/9d6169b9-022d-458c-9dc8-48cc94cc4083/download-log');
  });

  it('recordId 非法应抛 E_PARAM', async () => {
    const client = makeClient(() => '');
    const result = await getLogHandler(makeCtx(client) as never, { recordId: 'short' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
  });

  it('logLevel 非法应抛 E_PARAM', async () => {
    const client = makeClient(() => '');
    const result = await getLogHandler(makeCtx(client) as never, {
      recordId: '9d6169b9-022d-458c-9dc8-48cc94cc4083',
      logLevel: 'TRACE',
    });
    expect(result.isError).toBe(true);
  });

  it('响应非 ZIP 且非文本应抛 E_LOG', async () => {
    const client = makeClient(() => new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0xff]).buffer);
    const result = await getLogHandler(makeCtx(client) as never, {
      recordId: '9d6169b9-022d-458c-9dc8-48cc94cc4083',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_LOG');
  });
});

// ─── log-cleaner（FE-02-日志清洗器规范-20260918.md §11 样本基准） ───
describe('cleanLog', () => {
  it('空日志返回空结构化模型', () => {
    const out = cleanLog({ rawLog: '' });
    expect(out.structured).toEqual([]);
    expect(out.steps).toEqual([]);
    expect(out.error_summary).toBeNull();
    expect(out.finished).toBeNull();
  });

  it('识别 job_key / resource_pool / finished / task_states', () => {
    const log = [
      '[Sep 14, 2026 02:29:37.820 GMT+08:00] [INFO] : onStarted: j_KiBa9Q4j #1',
      '[Sep 14, 2026 02:29:38.000 GMT+08:00] [INFO] : [slave] resources pool message: default-x86-2u8g_suffix',
      '[Sep 14, 2026 02:29:40.000 GMT+08:00] [INTERNAL] : + docker pull busybox',
      '[Sep 14, 2026 02:29:41.000 GMT+08:00] [ERROR] [buildImage:buildImage] : Execute docker command failed. Error: DEV.CB.0210043',
      '[Sep 14, 2026 02:29:42.000 GMT+08:00] [INFO] : state: state_build_image_0.buildImage, status: error',
      '[Sep 14, 2026 02:29:43.000 GMT+08:00] [INFO] : Finished: FAILURE',
    ].join('\n');
    const out = cleanLog({ rawLog: log });

    expect(out.job_key).toBe('j_KiBa9Q4j');
    expect(out.resource_pool).toBe('default-x86-2u8g_suffix');
    expect(out.finished).toBe('FAILURE');
    expect(out.error_summary).not.toBeNull();
    expect(out.error_summary!.error_code).toBe('DEV.CB.0210043');
    expect(out.error_summary!.error_type).toBe('DOCKER_BUILD_FAILED');
  });

  it('错误分类：COMPILE_ERROR', () => {
    const out = cleanLog({ rawLog: '[ERROR] : Demo.java:42: error: cannot find symbol' });
    expect(out.error_summary!.error_type).toBe('COMPILE_ERROR');
  });

  it('错误分类：DEPENDENCY_MISSING', () => {
    const out = cleanLog({ rawLog: '[ERROR] : Could not resolve dependencies for project' });
    expect(out.error_summary!.error_type).toBe('DEPENDENCY_MISSING');
  });

  it('步骤分段：start/complete 成对', () => {
    const log = [
      '[INFO] [Cache Check:Cache Check] : This step is start',
      '[INFO] : step 1 body',
      '[INFO] [Cache Check:Cache Check] : This step is complete',
      '[INFO] [buildImage:buildImage] : This step is start',
      '[ERROR] [buildImage:buildImage] : Execute docker command failed',
    ].join('\n');
    const out = cleanLog({ rawLog: log });

    expect(out.steps).toHaveLength(2);
    expect(out.steps[0].name).toBe('Cache Check');
    expect(out.steps[0].status).toBe('success');
    expect(out.steps[1].name).toBe('buildImage');
    expect(out.steps[1].status).toBe('error'); // 未闭合 → error
  });

  it('脱敏：AK/SK/token/密码', () => {
    const log = 'AKIDABCDEFGHIJKLMNOPQRS x-auth-token: abc123 docker login -u user -p secret passwd=123456';
    const out = cleanLog({ rawLog: log, maxBytes: 10_000 });
    expect(out.raw_sample).not.toContain('AKIDABCDEFGHIJKLMNOPQRS');
    expect(out.raw_sample).not.toContain('abc123');
    expect(out.raw_sample).not.toContain('docker login -u user -p secret');
    expect(out.raw_sample).not.toContain('123456');
  });

  it('大日志三区采样 truncated=true', () => {
    const big = Array.from({ length: 500 }, (_, i) => `[INFO] : line ${i}`).join('\n');
    const out = cleanLog({ rawLog: big, maxBytes: 2048 });
    expect(out.truncated).toBe(true);
    expect(out.raw_sample.length).toBeLessThan(big.length);
  });
});

// ─── zip（FE-02-日志清洗器规范-20260918.md §9 解压规约） ───
describe('extractLogText', () => {
  it('ZIP 解压取 message.txt', () => {
        const zip = new AdmZip();
    zip.addFile('message.txt', Buffer.from('hello build log'));
    const buf = zip.toBuffer();
    const out = extractLogText(new Uint8Array(buf));
    expect(out.isZip).toBe(true);
    expect(out.text).toBe('hello build log');
  });

  it('非 ZIP 文本原样返回', () => {
    const out = extractLogText(new TextEncoder().encode('plain text log'));
    expect(out.isZip).toBe(false);
    expect(out.text).toBe('plain text log');
  });

  it('非 ZIP 二进制抛 E_LOG', () => {
    try {
      extractLogText(new Uint8Array([0x00, 0x01, 0x02, 0xff, 0x00]));
      expect.unreachable('应抛 E_LOG');
    } catch (e) {
      expect((e as { code: string }).code).toBe('E_LOG');
    }
  });

  it('zip-slip 路径条目（外部构造）拒绝解压', () => {
    // 手工构造含 ../evil.txt 条目的最小 ZIP（store 压缩，绕过 adm-zip 写入时的路径规范化）
    function buildRawZip(entryName: string, content: string): Uint8Array {
      const name = Buffer.from(entryName, 'utf-8');
      const data = Buffer.from(content, 'utf-8');
      const crc = crc32(data);
      // 本地文件头
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version
      local.writeUInt16LE(0, 6); // flags
      local.writeUInt16LE(0, 8); // method=store
      local.writeUInt16LE(0, 10); // time
      local.writeUInt16LE(0, 12); // date
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28); // extra len
      // 中央目录
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0, 8); // method
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(0, 12);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt16LE(0, 30); // extra
      central.writeUInt16LE(0, 32); // comment
      central.writeUInt16LE(0, 34); // disk
      central.writeUInt16LE(0, 36); // int attrs
      central.writeUInt32LE(0, 38); // ext attrs
      central.writeUInt32LE(0, 42); // local header offset
      // EOCD
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(0, 4);
      eocd.writeUInt16LE(0, 6);
      eocd.writeUInt16LE(1, 8); // entries
      eocd.writeUInt16LE(1, 10);
      eocd.writeUInt32LE(central.length + name.length, 12); // cd size
      eocd.writeUInt32LE(30 + name.length + data.length, 16); // cd offset
      eocd.writeUInt16LE(0, 20);
      return new Uint8Array(Buffer.concat([local, name, data, central, name, eocd]));
    }
    function crc32(buf: Buffer): number {
      let c = ~0;
      for (const b of buf) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
      }
      return ~c >>> 0;
    }
    expect(() => extractLogText(buildRawZip('../evil.txt', 'x'))).toThrow('非法路径');
  });
});
