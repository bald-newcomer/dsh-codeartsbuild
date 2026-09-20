/**
 * 工具结果工具函数（通用，不依赖具体承载层）
 * 对齐 tool-details.md §1.2（错误返回统一格式）
 */
import type { ErrorCode } from '../core/types.js';

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
