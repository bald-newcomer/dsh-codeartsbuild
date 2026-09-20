/**
 * 工具注册聚合
 * 对齐 architecture.md §4.1（src/tools/index.ts）
 * 每个工具的 schema + handler 聚合为 DshTool 定义，由 entry 注册
 */
import type { DshTool, ToolContext } from '@deepseek-ai/dsh';
import { createJobTool } from './schemas.js';
import { createJobHandler, type CreateJobHandlerInput } from '../providers/codeartsbuild/create-job.js';
import { HttpClient } from '../infra/http-client.js';
import { createCredentialProvider } from '../infra/credential-provider.js';

/** 从 ctx.config 解析凭据源 + 创建 HttpClient（单例） */
let httpClientInstance: HttpClient | null = null;

function getHttpClient(ctx: ToolContext): HttpClient {
  if (httpClientInstance) return httpClientInstance;
  const config = ctx.config as { credentialSource?: 'hcloud-config' | 'env'; proxyUrl?: string };
  const provider = createCredentialProvider(config?.credentialSource);
  httpClientInstance = new HttpClient(provider, { proxyUrl: config?.proxyUrl });
  return httpClientInstance;
}

/** 包装 createJob handler 为 DshTool handler */
function wrapCreateJobHandler(): DshTool['handler'] {
  return async (ctx: ToolContext, input: unknown) => {
    const client = getHttpClient(ctx);
    return createJobHandler(
      {
        client,
        session: ctx.session,
        envProjectId: process.env.CAB_PROJECT_ID ?? process.env.CODEARTS_BUILD_PROJECT_ID,
      },
      input as CreateJobHandlerInput,
    );
  };
}

/** 全部工具定义（待注册） */
export function buildTools(): DshTool[] {
  return [
    {
      ...createJobTool,
      handler: wrapCreateJobHandler(),
    },
  ];
}

/** 重置 HTTP 客户端（测试用） */
export function resetHttpClient(): void {
  httpClientInstance = null;
}
