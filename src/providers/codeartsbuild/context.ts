/**
 * 云侧工具共享上下文（handler 注入面）
 * 对齐 architecture.md §4.1（工具 handler 与 HttpClient 解耦）
 */
import type { HttpClient } from '../../infra/http-client.js';
import type { SessionContext } from '../../core/session.js';

/** 云侧工具上下文（由 tools/index.ts 统一注入） */
export interface CloudToolContext {
  /** 自建 HTTP 客户端（AK/SK 签名） */
  client: HttpClient;
  /** 会话上下文（projectId 缓存） */
  session?: SessionContext;
  /** 配置默认 projectId（env） */
  envProjectId?: string;
}
