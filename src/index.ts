/**
 * 模块出口（聚合导出）
 * 对齐 architecture.md §4.1（src/index.ts）
 */
export * from './entry/index.js';
export { createJobHandler } from './providers/codeartsbuild/create-job.js';
export {
  assembleConfig,
  assembleSteps,
  resolveStep,
  validateSteps,
  selectTemplates,
  listAvailableTemplates,
  listAvailableLanguages,
  listWhitelistModuleIds,
} from './providers/codeartsbuild/template-assembler.js';
export { HttpClient } from './infra/http-client.js';
export {
  createCredentialProvider,
  EnvCredentialProvider,
  type CredentialProvider,
  type CredentialSource,
} from './infra/credential-provider.js';
export { makeErrorResult, makeSuccessResult } from './infra/tool-result.js';
export * from './core/types.js';
export type { BuildProvider } from './core/provider.js';
export { resolveProjectId } from './core/session.js';
