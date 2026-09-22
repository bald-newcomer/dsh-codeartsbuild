/**
 * 本地构建 Provider 聚合导出
 * 对齐 architecture.md §4.6（local-build/ 与云侧对等）
 */
export { repoBuildHandler } from './build.js';
export type { RepoBuildHandlerInput } from './build.js';
export { probeRepo } from './probe.js';
export { buildGuidance, recommendedSteps } from './guidance.js';
export { scanArtifacts } from './artifact.js';
export { archiveBuild } from './archive.js';
