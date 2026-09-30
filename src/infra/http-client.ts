/**
 * 自建 HTTP 客户端封装（AK/SK 签名 + 错误映射 + 重试）
 * 对齐 architecture.md §3.3.1 + FE-06-自建HTTP承载切换方案-20260920.md §3
 *
 * 职责：
 * 1. 基于 api-contract.md 接口契约构造 HTTP 请求（method + path + query + body）
 * 2. AK/SK 签名（AKSKSigner，与华为云官方 SDK 同源）
 * 3. 错误映射（HTTP 状态码 → ToolException）
 * 4. 幂等重试 ≤3 次（E_NETWORK 类）
 * 5. 代理支持（内网访问华为云公网 API）
 * 6. **多 CodeArts 服务适配**（2026-09-23）：请求按 `service` 解析对应 endpoint——
 *    codeartsbuild（cloudbuild-ext）/ codeartsrepo（codehub-ext）等，默认 codeartsbuild
 *
 * region → endpoint 映射表内嵌（从各服务 SDK Region 表提取，不依赖运行时 SDK）
 */
import { AKSKSigner } from '@huaweicloud/huaweicloud-sdk-core/auth/AKSKSigner.js';
import type { CredentialProvider } from './credential-provider.js';
import { ToolException } from '../core/types.js';

/** 支持的 CodeArts 服务（endpoint 前缀 → 服务名） */
export type CodeArtsService = 'codeartsbuild' | 'codeartsrepo';

/** 各服务 region → endpoint 前缀（主机名不含协议，协议统一 https） */
const SERVICE_REGION_HOSTS: Record<CodeArtsService, Record<string, string>> = {
  // 编译构建（与 huaweicloud-sdk-codeartsbuild Region 表一致，2026-09-20 提取）
  codeartsbuild: {
    'cn-north-4': 'cloudbuild-ext.cn-north-4.myhuaweicloud.com',
    'cn-north-1': 'cloudbuild-ext.cn-north-1.myhuaweicloud.com',
    'cn-east-2': 'cloudbuild-ext.cn-east-2.myhuaweicloud.com',
    'cn-south-1': 'cloudbuild-ext.cn-south-1.myhuaweicloud.com',
    'cn-east-3': 'cloudbuild-ext.cn-east-3.myhuaweicloud.com',
    'cn-south-2': 'cloudbuild-ext.cn-south-2.myhuaweicloud.com',
    'cn-southwest-2': 'cloudbuild-ext.cn-southwest-2.myhuaweicloud.com',
    'ap-southeast-3': 'cloudbuild-ext.ap-southeast-3.myhuaweicloud.com',
    'sa-brazil-1': 'cloudbuild-ext.sa-brazil-1.myhuaweicloud.com',
    'la-north-2': 'cloudbuild-ext.la-north-2.myhuaweicloud.com',
    'la-south-2': 'cloudbuild-ext.la-south-2.myhuaweicloud.com',
    'tr-west-1': 'cloudbuild-ext.tr-west-1.myhuaweicloud.com',
  },
  // 代码托管（CodeArtsRepo，2026-09-23 文档确认：codehub-ext.{region}，个别区域 codeartsrepo-ext）
  codeartsrepo: {
    'cn-north-4': 'codehub-ext.cn-north-4.myhuaweicloud.com',
    'cn-north-1': 'codehub-ext.cn-north-1.myhuaweicloud.com',
    'cn-east-2': 'codehub-ext.cn-east-2.myhuaweicloud.com',
    'cn-south-1': 'codehub-ext.cn-south-1.myhuaweicloud.com',
    'cn-east-3': 'codehub-ext.cn-east-3.myhuaweicloud.com',
    'cn-south-2': 'codehub-ext.cn-south-2.myhuaweicloud.com',
    'cn-southwest-2': 'codehub-ext.cn-southwest-2.myhuaweicloud.com',
    'ap-southeast-3': 'codehub-ext.ap-southeast-3.myhuaweicloud.com',
    'sa-brazil-1': 'codehub-ext.sa-brazil-1.myhuaweicloud.com',
    'la-north-2': 'codehub-ext.la-north-2.myhuaweicloud.com',
    'la-south-2': 'codeartsrepo-ext.la-south-2.myhuaweicloud.com',
    'tr-west-1': 'codehub-ext.tr-west-1.myhuaweicloud.com',
  },
};

/** region → endpoint 映射（默认服务 codeartsbuild，向后兼容：原 REGION_ENDPOINTS 导出） */
export const REGION_ENDPOINTS: Record<string, string> = Object.fromEntries(
  Object.entries(SERVICE_REGION_HOSTS.codeartsbuild).map(([region, host]) => [region, `https://${host}`]),
);

/** 解析 service+region → 完整 endpoint URL */
export function resolveEndpoint(service: CodeArtsService, region: string): string | undefined {
  const host = SERVICE_REGION_HOSTS[service]?.[region];
  return host ? `https://${host}` : undefined;
}

/** HTTP 请求定义（基于契约 §2 的 method + URL path） */
export interface HttpRequest {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT';
  /** 契约 §2 标注的 URL path，如 /v1/job/create */
  path: string;
  /** 目标 CodeArts 服务（默认 codeartsbuild；repo 类工具用 codeartsrepo） */
  service?: CodeArtsService;
  /** 查询参数（可选；数组展开为重复 query key，boolean 转字符串） */
  query?: Record<string, string | number | boolean | string[] | undefined>;
  /** 请求体（可选，JSON 序列化） */
  body?: unknown;
}

/** HTTP 调用选项 */
export interface HttpCallOptions {
  /** 是否幂等命令（支持重试，默认 false） */
  idempotent?: boolean;
  /** 最大重试次数（幂等命令默认 3） */
  maxRetries?: number;
  /** 调用超时（ms，默认 60s） */
  timeoutMs?: number;
  /** 返回原始文本（如日志下载，默认 false=JSON 解析） */
  rawText?: boolean;
  /** 返回二进制字节（如日志 ZIP 下载，优先级高于 rawText） */
  rawBinary?: boolean;
}

/** SDK 签名器要求的 credential 形状 */
interface SignerCredential {
  getAk(): string;
  getSk(): string;
}

/** HTTP 客户端封装（AK/SK 签名 + 错误映射 + 重试） */
export class HttpClient {
  private provider: CredentialProvider;
  private proxyUrl?: string;

  constructor(provider: CredentialProvider, opts?: { proxyUrl?: string }) {
    this.provider = provider;
    this.proxyUrl = opts?.proxyUrl;
  }

  /**
   * 发送请求（AK/SK 签名 + 错误映射 + 幂等重试）
   * @param req 请求定义（method + path + query + body）
   * @param opts 调用选项
   */
  async call<T = unknown>(req: HttpRequest, opts?: HttpCallOptions): Promise<T> {
    const maxRetries = opts?.idempotent ? (opts?.maxRetries ?? 3) : 1;
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    let lastError: ToolException | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.sendOnce<T>(req, timeoutMs, opts);
      } catch (e) {
        lastError = e instanceof ToolException ? e : new ToolException('E_API', `HTTP 调用失败: ${(e as Error).message}`);
        const isNetwork = lastError.code === 'E_NETWORK';
        const isLastAttempt = attempt >= maxRetries;
        if (!isNetwork || isLastAttempt) break;
        // 重试前等待 2s
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw lastError ?? new ToolException('E_API', `HTTP ${req.method} ${req.path} 调用失败（未知原因）`);
  }

  /** 单次请求发送 */
  private async sendOnce<T>(req: HttpRequest, timeoutMs: number, opts?: HttpCallOptions): Promise<T> {
    const { ak, sk } = await this.provider.getCredentials();
    const region = this.provider.getRegion();
    const service: CodeArtsService = req.service ?? 'codeartsbuild';
    const endpoint = resolveEndpoint(service, region);
    if (!endpoint) {
      const available = SERVICE_REGION_HOSTS[service] ?? {};
      throw new ToolException(
        'E_CONFIG',
        `service="${service}" region="${region}" 无对应 endpoint`,
        `可用 region: ${Object.keys(available).join(', ')}`,
      );
    }

    const url = new URL(endpoint + req.path);
    if (req.query) {
      for (const [k, v] of Object.entries(req.query)) {
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v)) {
          // 数组参数展开为重复 query key（如 branches=a&branches=b）
          for (const item of v) {
            if (item !== undefined && item !== null && item !== '') url.searchParams.append(k, String(item));
          }
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const body = req.body !== undefined ? JSON.stringify(req.body) : undefined;
    const baseHeaders: Record<string, string> = { 'content-type': 'application/json' };

    // queryParams 对象（签名器 CanonicalQueryString 读取 request.queryParams，非 endpoint 内 query——
    // 2026-09-21 实调发现：GET 带 query 时漏传导致 401 APIGW.0301 签名不匹配）
    const queryParams: Record<string, string | string[]> = {};
    for (const [k, v] of url.searchParams.entries()) {
      if (queryParams[k] === undefined) queryParams[k] = v;
      else if (Array.isArray(queryParams[k])) (queryParams[k] as string[]).push(v);
      else queryParams[k] = [queryParams[k] as string, v];
    }

    // AK/SK 签名（与 SDK 同源；endpoint 必须含协议头供签名器解析 host）
    const signedHeaders = AKSKSigner.sign(
      {
        method: req.method,
        endpoint: url.toString(),
        headers: baseHeaders,
        data: req.body !== undefined ? req.body : undefined,
        queryParams,
      },
      { getAk: () => ak, getSk: () => sk } satisfies SignerCredential,
    );

    const fetchOptions: RequestInit = {
      method: req.method,
      headers: { ...baseHeaders, ...signedHeaders },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body) fetchOptions.body = body;

    let response: Response;
    try {
      response = await this.fetchWithProxy(url.toString(), fetchOptions);
    } catch (e) {
      // 网络类错误（fetch reject / 超时 abort）→ E_NETWORK
      const msg = (e as Error).message ?? 'unknown';
      throw new ToolException('E_NETWORK', `HTTP 请求失败: ${msg}`, { url: url.toString() });
    }

    // 错误映射
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw mapHttpError(response.status, errBody);
    }

    if (opts?.rawBinary) {
      // 二进制返回（如日志 ZIP 下载）：响应体不可按 UTF-8 解码，直接返回字节
      return (await response.arrayBuffer()) as T;
    }
    if (opts?.rawText) return (await response.text()) as T;
    // 空响应体处理
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  /** fetch 发送（支持代理：经 undici fetch + ProxyAgent，Node 内置 fetch 不接受外部 dispatcher） */
  private async fetchWithProxy(url: string, options: RequestInit): Promise<Response> {
    // Node 内置 fetch 不自动使用 HTTPS_PROXY/HTTP_PROXY，且其内置 undici 与外部 dispatcher
    // 版本不匹配（UND_ERR_INVALID_ARG）。统一用 undici 的 fetch：
    //  - 无代理：undici fetch（与 Node fetch 行为一致）
    //  - 有代理：undici fetch + ProxyAgent dispatcher
    // undici 自带类型与 @types/node 的 DOM 类型（FormData/File）冲突，这里用最小接口收窄；
    // dispatcher 字段运行时为 undici ProxyAgent（Dispatcher 子类），编译期经 as never 传递
    const undici = (await import('undici')) as unknown as {
      fetch: (url: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<Response>;
      ProxyAgent: new (proxyUrl: string) => unknown;
    };
    const proxyUrl = this.proxyUrl ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
    if (!proxyUrl) {
      return await undici.fetch(url, options);
    }
    const dispatcher = new undici.ProxyAgent(proxyUrl);
    return await undici.fetch(url, { ...options, dispatcher: dispatcher as never });
  }
}

/** HTTP 状态码 → ToolException 映射 */
function mapHttpError(status: number, body: string): ToolException {
  // 华为云错误响应体通常是 { "error_code": "...", "error_msg": "..." }
  let errorCode = '';
  let errorMsg = body.slice(0, 500);
  try {
    const parsed = JSON.parse(body) as { error_code?: string; error_msg?: string };
    errorCode = parsed.error_code ?? '';
    errorMsg = parsed.error_msg ?? errorMsg;
  } catch {
    // 非 JSON 响应体，直接用文本
  }

  const details = { httpStatusCode: status, errorCode, ...(errorMsg ? { errorMsg } : {}) };
  if (status === 401) return new ToolException('E_AUTH', `认证失败（401）: ${errorMsg}`, details);
  if (status === 403) return new ToolException('E_AUTH', `权限不足（403）: ${errorMsg}`, details);
  if (status >= 400 && status < 500) return new ToolException('E_PARAM', `参数错误（${status}）: ${errorMsg}`, details);
  return new ToolException('E_API', `业务错误（${status}）: ${errorMsg}`, details);
}
