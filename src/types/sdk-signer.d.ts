/**
 * 华为云 SDK 签名库类型 stub（AKSKSigner）
 *
 * sdk-core 包未暴露 types/exports（无 package.json types 字段），TS 无法解析
 * 内部子路径 `@huaweicloud/huaweicloud-sdk-core/auth/AKSKSigner`。
 * 本文件为最小类型声明（运行时由 Node CJS interop 加载真实实现）。
 * 对齐 FE-06-自建HTTP承载切换方案-20260920.md §2.1（仅保留签名库）。
 */
declare module '@huaweicloud/huaweicloud-sdk-core/auth/AKSKSigner.js' {
  /** 签名请求（与 SDK IHttpRequest 同构） */
  export interface SignerHttpRequest {
    method?: string;
    endpoint?: string;
    headers?: Record<string, string>;
    data?: unknown;
    queryParams?: Record<string, unknown>;
  }

  /** 签名凭据（getAk/getSk） */
  export interface SignerCredential {
    getAk(): string;
    getSk(): string;
  }

  export class AKSKSigner {
    /** 生成签名头（含 Authorization / X-Sdk-Date / host），返回完整 headers */
    static sign(request: SignerHttpRequest, credential: SignerCredential): Record<string, string>;
  }

  export class RequiredError extends Error {
    field: string;
    constructor(field: string, msg?: string);
  }
}
