/**
 * dsh 运行时类型声明（dsh 包未提供完整 .d.ts 于本项目，本文件为最小类型 stub）
 * dsh 运行时注入 ctx，插件通过 apply(ctx) 接收
 *
 * 工具契约（dsh v0.1.1，@deepseek-ai/dsh-tools）：
 *   { name, description, parameters(JSON Schema), execute(args)→JsonValue, output:{schema, render} }
 * 本文件仅声明 apply 侧；工具定义实际由 @deepseek-ai/dsh-tools defineTool 构造。
 */
declare module '@deepseek-ai/dsh' {
  export interface ToolContext {
    /** 工具注册器（dsh-tools ToolRuntime） */
    tools: {
      register(tool: unknown): unknown;
    };
    /** 插件配置（来自 cordis.patch.yml config 段） */
    config: Record<string, unknown>;
    /** 会话级状态（内存，不落盘） */
    session?: SessionState;
  }

  export interface SessionState {
    /** projectId 会话级缓存 */
    projectId?: string;
  }

  /** dsh 工具定义（defineTool 产物） */
  export interface DshTool {
    name: string;
    description: string;
    parameters: unknown;
    output: unknown;
    execute(args: unknown, exec: unknown): Promise<unknown>;
  }

  /** apply 入口函数签名（可附带 cordis inject 声明：依赖的服务名数组） */
  export type ApplyFn = ((ctx: ToolContext) => void | Promise<void>) & {
    inject?: string[];
  };
}
