/**
 * dsh 工具契约适配层
 * 对齐 dsh v0.1.1 工具注册契约（@deepseek-ai/dsh-tools defineTool）：
 *   { name, description, parameters(标准JSON Schema), execute(args)→JsonValue, output:{schema, render} }
 *
 * 与旧契约（{schema(schemastery), handler}）的关系：
 *   handler 保留（业务逻辑不变），适配层补充 parameters JSON Schema + execute 包装 + output 声明。
 *
 * 上下文注入（execute 无 ctx 参数）：HttpClient 为模块级单例，首次调用时从
 *   环境变量（CAB_AK/CAB_SK/region）+ profile 配置（credentialSource/proxyUrl，经 configureTools 注入）创建。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolResult } from '../core/types.js';
import { HttpClient } from '../infra/http-client.js';
import { createCredentialProvider } from '../infra/credential-provider.js';
import type { CloudToolContext } from '../providers/codeartsbuild/context.js';

/** 云侧工具上下文（模块级单例注入面） */
let sharedContext: CloudToolContext | null = null;
let pluginConfig: { credentialSource?: 'hcloud-config' | 'env'; proxyUrl?: string } = {};

/**
 * 配置工具运行时（dsh 插件 apply 时调用，注入 profile config）
 * @param config plugin 配置（cordis.patch.yml 的 config 段）
 */
export function configureTools(config: Record<string, unknown>): void {
  pluginConfig = config as typeof pluginConfig;
  sharedContext = null; // 配置变更后重建 HttpClient
}

/** 获取云侧上下文（惰性创建 HttpClient 单例 + 会话状态） */
function getContext(): CloudToolContext {
  if (!sharedContext) {
    const provider = createCredentialProvider(pluginConfig?.credentialSource);
    // proxyUrl 优先级：插件配置 > 环境变量 HTTPS_PROXY/HTTP_PROXY（内网需代理访问华为云 API）
    const proxyUrl = pluginConfig?.proxyUrl ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
    const client = new HttpClient(provider, { proxyUrl });
    sharedContext = { client, session: {}, envProjectId: process.env.CAB_PROJECT_ID ?? process.env.CODEARTS_BUILD_PROJECT_ID };
  }
  return sharedContext;
}

/** 重置上下文（测试用） */
export function resetToolsContext(): void {
  sharedContext = null;
}

/** 云侧 handler 签名（复用现有 handler） */
type CloudHandler<TInput> = (ctx: CloudToolContext, input: TInput) => Promise<ToolResult>;

/** 本地 handler 签名（无 ctx） */
type LocalHandler<TInput> = (input: TInput) => Promise<ToolResult>;

/** 通用内部工具定义（适配层输入）——TInput 宽松（dsh 参数为未知 JSON，handler 内做类型收窄） */
export interface InternalToolDef<TInput = unknown> {
  name: string;
  description: string;
  /** 标准 JSON Schema 参数定义（dsh parameterSchemaSpec 兼容：每属性 {type, description, required?}） */
  parameters: Record<string, unknown>;
  /** 云侧或本地 handler */
  handler: CloudHandler<TInput> | LocalHandler<TInput>;
  /** 是否为本地工具（无 ctx） */
  local?: boolean;
}

/** 宽松输出 schema（所有工具返回对象；dsh 要求 additionalProperties 显式） */
const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true };

/**
 * 适配为 dsh 工具定义（defineTool 产物）
 * - execute(args)：调 handler → isError 抛错 → 成功返回 data
 * - output.render：把 value 转 text ContentBlock
 */
export function toDshTool<TInput>(def: InternalToolDef<TInput>) {
  // 适配层内部：parameters/output/execute 类型经 dsh 编译器运行时校验，编译期放宽
  return defineTool({
    name: def.name,
    description: def.description,
    parameters: def.parameters as never,
    output: {
      schema: OUTPUT_SCHEMA as never,
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args: unknown) {
      const input = args as TInput;
      const result = def.local
        ? await (def.handler as LocalHandler<TInput>)(input)
        : await (def.handler as CloudHandler<TInput>)(getContext(), input);
      if (result.isError) {
        throw new Error(result.content?.[0]?.text ?? 'tool failed');
      }
      return (result.data ?? { ok: true }) as never;
    },
  });
}
