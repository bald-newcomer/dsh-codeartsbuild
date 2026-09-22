/**
 * 会话上下文 — projectId 会话级传递
 * 对齐 architecture.md §4.3（一次填写/自动复用/优先级链）
 * 优先级：工具显式入参 > 会话上下文 > 配置默认值（CODEARTS_BUILD_PROJECT_ID）> 询问
 */
import { ToolException } from './types.js';

/** 会话上下文接口（由 dsh ctx.session 注入，本文件定义访问规约） */
export interface SessionContext {
  projectId?: string;
}

/** 从会话上下文解析 projectId（缺省时抛 E_PARAM） */
export function resolveProjectId(
  explicit: string | undefined,
  session: SessionContext | undefined,
  envDefault: string | undefined,
): string {
  let resolved: string;
  // 显式入参
  if (explicit && explicit.trim()) {
    resolved = explicit;
  }
  // 会话上下文
  else if (session?.projectId && session.projectId.trim()) {
    resolved = session.projectId;
  }
  // 配置默认值
  else if (envDefault && envDefault.trim()) {
    resolved = envDefault;
  }
  else {
    throw new ToolException(
      'E_PARAM',
      'projectId 缺省且会话上下文/配置默认值均无值',
      '请显式传 projectId，或先调 list_projects 选择后重试',
    );
  }
  // 解析成功统一刷新会话（显式/env 来源进入会话，后续复用）
  if (session) session.projectId = resolved;
  return resolved;
}
