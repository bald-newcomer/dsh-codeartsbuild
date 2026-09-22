/**
 * 工具结果工具函数（通用，不依赖具体承载层）
 * 对齐 tool-details.md §1.2（错误返回统一格式）
 */
import type { ErrorCode } from '../core/types.js';
import { ToolException } from '../core/types.js';

/** 构造工具错误返回（统一格式） */
export function makeErrorResult(code: ErrorCode, message: string, details?: unknown) {
  const text = details
    ? `[${code}] ${message}\n详情: ${typeof details === 'string' ? details : JSON.stringify(details)}`
    : `[${code}] ${message}`;
  return {
    content: [{ type: 'text' as const, text }],
    isError: true as const,
  };
}

/** 构造工具成功返回（统一格式） */
export function makeSuccessResult(data: unknown, summary?: string) {
  const text = summary ?? JSON.stringify(data, null, 2);
  return {
    content: [{ type: 'text' as const, text }],
    isError: false as const,
    data,
  };
}

/**
 * 统一错误映射（handler 骨架 catch 分支）
 * ToolException → 透传其错误码；其余异常 → 归为 fallbackCode
 */
export function mapToolError(e: unknown, fallbackCode: ErrorCode = 'E_API') {
  if (e instanceof ToolException) {
    return makeErrorResult(e.code, e.message, e.details);
  }
  return makeErrorResult(fallbackCode, `${fallbackCode} 未知异常: ${(e as Error).message}`, (e as Error).stack);
}
