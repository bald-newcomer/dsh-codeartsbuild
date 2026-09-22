/**
 * dsh 插件入口（官方规范形态）
 * 对齐 deepseek-harness docs/user/develop/basic/*.zh.md（2026-09-21 联网确认）
 *
 * 官方插件标准：
 *   export const name            — 插件名（kebab-case，全局唯一）
 *   export const inject = [...]  — 依赖的服务键（Loader 据此排序，tools 就绪后才加载）
 *   export function apply(ctx, config) — 注册能力
 *   export const Config          — Schemastery schema（配置校验 + 默认值）
 *
 * 承载：自建 HTTP（AK/SK 签名）——凭据经 Config 的 credentialSource 选择注入源。
 */
import type { Context } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import { buildTools } from '../tools/index.js';
import { configureTools } from '../tools/dsh-adapter.js';

/** 插件名（kebab-case） */
export const name = 'codeartsbuild';

/** 依赖服务：tools（工具注册表）就绪后才加载 */
export const inject = ['tools'];

/** 插件配置 schema（cordis.patch.yml config 段校验 + 默认值） */
export interface Config {
  /** 凭据源：hcloud-config（默认，复用 ~/.hcloud/config.json）或 env（CAB_AK/CAB_SK） */
  credentialSource?: 'hcloud-config' | 'env';
  /** 内网代理（如 http://proxycn2.huawei.com:8080） */
  proxyUrl?: string;
  /** region（决定 endpoint；默认 cn-north-4） */
  region?: string;
}

export const Config = schema.object({
  credentialSource: schema.union(['hcloud-config', 'env']).default('hcloud-config').description('凭据源：hcloud-config（复用 ~/.hcloud/config.json）或 env（CAB_AK/CAB_SK）'),
  proxyUrl: schema.string().description('内网代理（可选）').required(false),
  region: schema.string().default('cn-north-4').description('region，决定 endpoint'),
});

/**
 * 插件入口：注册 16 个 CodeArtsBuild 工具
 * @param ctx cordis 上下文（注入 tools 服务）
 * @param config 插件配置（经 Config schema 校验 + 默认值填充）
 */
export function apply(ctx: Context, config: Config) {
  // 注入配置到工具运行时（credentialSource/proxyUrl/region）
  configureTools({ ...config });
  const tools = buildTools();
  for (const tool of tools) {
    ctx.tools.register(tool);
  }
}
