/**
 * dsh 运行时类型声明（dsh 包未提供 .d.ts，本文件为最小类型 stub）
 * dsh 运行时注入 ctx，插件通过 apply(ctx) 接收
 */
declare module '@deepseek-ai/dsh' {
  export interface ToolContext {
    /** 工具注册器 */
    tools: {
      register(tool: DshTool): void;
    };
    /** 插件配置（来自 cordis.yml） */
    config: Record<string, unknown>;
    /** 会话级状态（内存，不落盘） */
    session?: SessionState;
  }

  export interface SessionState {
    /** projectId 会话级缓存 */
    projectId?: string;
  }

  export interface DshTool {
    name: string;
    description: string;
    schema: unknown;
    handler: (ctx: ToolContext, input: unknown) => Promise<ToolResult> | ToolResult;
  }

  export interface ToolResult {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }

  /** defineTool 工厂函数 */
  export function defineTool(tool: DshTool): DshTool;

  /** apply 入口函数签名 */
  export type ApplyFn = (ctx: ToolContext) => void | Promise<void>;
}
