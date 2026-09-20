/**
 * http-client 单测（Layer 1，mock undici fetch，不需网络）
 * 对齐 http-migration-plan.md §3 + architecture.md §10
 *
 * 注：http-client 经 `import('undici')` 动态加载 fetch（代理支持），
 * 测试用 vi.mock('undici') 拦截其 fetch / ProxyAgent。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { HttpClient, REGION_ENDPOINTS } from '../src/infra/http-client.js';

/** 固定凭据 provider（无网络） */
const fakeProvider = {
  getCredentials: vi.fn().mockResolvedValue({ ak: 'test-ak', sk: 'test-sk' }),
  getRegion: () => 'cn-north-4',
};

// ─── mock undici 模块 ───
const mockFetch = vi.fn();
const mockProxyAgent = vi.fn();

vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
  ProxyAgent: class {
    constructor(url: string) {
      mockProxyAgent(url);
    }
  },
}));

/** 构造模拟响应 */
function mockResponse(overrides?: Partial<Response>, error?: Error) {
  if (error) {
    mockFetch.mockRejectedValueOnce(error);
    return;
  }
  mockFetch.mockResolvedValueOnce({
    ok: overrides?.ok ?? true,
    status: overrides?.status ?? 200,
    text: async () => overrides?.text ?? '{}',
  } as Response);
}

beforeEach(() => {
  mockFetch.mockReset();
  mockProxyAgent.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('HttpClient', () => {
  it('应构造完整 URL（endpoint + path + query）', async () => {
    mockResponse({ ok: true, status: 200, text: '{"result":{"job_id":"abc"}}' });
    const client = new HttpClient(fakeProvider);

    await client.call<{ result: { job_id: string } }>({
      method: 'POST',
      path: '/v1/job/create',
      body: { arch: 'x86-64', job_name: 't' },
    });

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cloudbuild-ext.cn-north-4.myhuaweicloud.com/v1/job/create');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe('{"arch":"x86-64","job_name":"t"}');
  });

  it('应附加 AK/SK 签名头（Authorization/X-Sdk-Date/host）', async () => {
    mockResponse({ ok: true, status: 200, text: '{}' });
    const client = new HttpClient(fakeProvider);

    await client.call({ method: 'GET', path: '/v1/job/list' });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^SDK-HMAC-SHA256 Access=test-ak/);
    expect(headers['X-Sdk-Date']).toBeTruthy();
    expect(headers.host).toBe('cloudbuild-ext.cn-north-4.myhuaweicloud.com');
  });

  it('应解析 JSON 响应并返回 data', async () => {
    mockResponse({ ok: true, status: 200, text: '{"result":{"job_id":"abc"}}' });
    const client = new HttpClient(fakeProvider);

    const data = await client.call<{ result: { job_id: string } }>({ method: 'POST', path: '/v1/job/create', body: {} });
    expect(data.result.job_id).toBe('abc');
  });

  it('rawText 应返回原始文本（日志下载场景）', async () => {
    mockResponse({ ok: true, status: 200, text: 'raw log line 1\nraw log line 2' });
    const client = new HttpClient(fakeProvider);

    const text = await client.call<string>({ method: 'GET', path: '/v1/log/abc/download-log' }, { rawText: true });
    expect(text).toBe('raw log line 1\nraw log line 2');
  });

  it('401 应映射 E_AUTH', async () => {
    mockResponse({ ok: false, status: 401, text: '{"error_code":"APIGW.0101","error_msg":"Unauthorized"}' });
    const client = new HttpClient(fakeProvider);

    await expect(client.call({ method: 'GET', path: '/v1/job/list' })).rejects.toMatchObject({
      code: 'E_AUTH',
    });
  });

  it('403 应映射 E_AUTH', async () => {
    mockResponse({ ok: false, status: 403, text: '{"error_code":"DEVCB.00030000","error_msg":"No permission"}' });
    const client = new HttpClient(fakeProvider);

    await expect(client.call({ method: 'GET', path: '/v1/job/list' })).rejects.toMatchObject({
      code: 'E_AUTH',
    });
  });

  it('4xx 应映射 E_PARAM（含 error_code/error_msg）', async () => {
    mockResponse({ ok: false, status: 400, text: '{"error_code":"DEVCB.00010000","error_msg":"Invalid parameter"}' });
    const client = new HttpClient(fakeProvider);

    await expect(client.call({ method: 'POST', path: '/v1/job/create', body: {} })).rejects.toMatchObject({
      code: 'E_PARAM',
      details: { errorCode: 'DEVCB.00010000' },
    });
  });

  it('5xx 应映射 E_API', async () => {
    mockResponse({ ok: false, status: 500, text: '{"error_code":"DEVCB.00020000","error_msg":"Internal error"}' });
    const client = new HttpClient(fakeProvider);

    await expect(client.call({ method: 'GET', path: '/v1/job/list' })).rejects.toMatchObject({
      code: 'E_API',
    });
  });

  it('网络错误（fetch reject）应映射 E_NETWORK', async () => {
    mockResponse(undefined, new Error('fetch failed: ETIMEDOUT'));
    const client = new HttpClient(fakeProvider);

    await expect(client.call({ method: 'GET', path: '/v1/job/list' })).rejects.toMatchObject({
      code: 'E_NETWORK',
    });
  });

  it('幂等请求网络错误应重试（默认 3 次）', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('fetch failed: ETIMEDOUT'))
      .mockRejectedValueOnce(new Error('fetch failed: ETIMEDOUT'))
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' } as Response);
    const client = new HttpClient(fakeProvider);

    await client.call({ method: 'GET', path: '/v1/job/list' }, { idempotent: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('非幂等请求网络错误不重试', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed'));
    const client = new HttpClient(fakeProvider);

    await expect(client.call({ method: 'GET', path: '/v1/job/list' })).rejects.toMatchObject({ code: 'E_NETWORK' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('未知 region 应抛 E_CONFIG', async () => {
    const client = new HttpClient({ getCredentials: fakeProvider.getCredentials, getRegion: () => 'cn-unknown-1' });
    await expect(client.call({ method: 'GET', path: '/v1/job/list' })).rejects.toMatchObject({ code: 'E_CONFIG' });
  });

  it('配置 proxyUrl 时经 ProxyAgent 发送', async () => {
    mockResponse({ ok: true, status: 200, text: '{}' });
    const client = new HttpClient(fakeProvider, { proxyUrl: 'http://proxy.local:8080' });

    await client.call({ method: 'GET', path: '/v1/job/list' });

    expect(mockProxyAgent).toHaveBeenCalledWith('http://proxy.local:8080');
    // dispatcher 传入 undici fetch
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.dispatcher).toBeTruthy();
  });

  it('未配置代理时直连（不构造 ProxyAgent）', async () => {
    mockResponse({ ok: true, status: 200, text: '{}' });
    const client = new HttpClient(fakeProvider);

    await client.call({ method: 'GET', path: '/v1/job/list' });

    expect(mockProxyAgent).not.toHaveBeenCalled();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.dispatcher).toBeUndefined();
  });

  it('REGION_ENDPOINTS 应覆盖主要 region', () => {
    expect(REGION_ENDPOINTS['cn-north-4']).toBe('https://cloudbuild-ext.cn-north-4.myhuaweicloud.com');
    expect(REGION_ENDPOINTS['ap-southeast-3']).toBe('https://cloudbuild-ext.ap-southeast-3.myhuaweicloud.com');
    expect(Object.keys(REGION_ENDPOINTS).length).toBeGreaterThanOrEqual(12);
  });
});
