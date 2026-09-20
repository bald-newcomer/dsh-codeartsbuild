/**
 * dsh 插件入口
 * 对齐 architecture.md §4.1（src/entry/index.ts）
 *
 * apply(ctx) 是 dsh 加载的唯一入口：构建全部工具定义并注册到 ctx.tools
 * （cordis.patch.yml 合并 / lib 加载由 dsh 宿主完成，本文件不涉及）
 */
import type { ApplyFn, ToolContext } from '@deepseek-ai/dsh';
import { buildTools } from '../tools/index.js';

const apply: ApplyFn = (ctx: ToolContext) => {
  const tools = buildTools();
  for (const tool of tools) {
    ctx.tools.register(tool);
  }
};
export { apply };
