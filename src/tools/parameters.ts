/**
 * 各工具参数 JSON Schema（dsh parameterSchemaSpec 兼容格式）
 * 对齐 api-contract.md §2 各工具入参；替代 schemastery（其 toJSON 非标准 JSON Schema）
 *
 * 格式：每属性 { type, description, required?, enum?, items?, properties? }
 * required: true 表示必填（dsh 编译器收集到根级 required）
 */
import type { InternalToolDef } from './dsh-adapter.js';

/** create_job 参数（契约 §2.4） */
export const createJobParameters: Record<string, unknown> = {
  projectId: { type: 'string', description: '项目 ID（32 位数字字母），缺省取会话上下文' },
  jobName: { type: 'string', description: '任务名称（1~115）', required: true },
  arch: { type: 'string', description: '机器架构', enum: ['x86-64', 'arm'], required: true },
  stepsPlan: {
    type: 'array',
    description: '意图级步骤计划 [{step, properties?}]',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        step: { type: 'string', description: 'template_id 或 module_id' },
        properties: { type: 'object', additionalProperties: true, description: '覆盖该步默认参数' },
      },
    },
  },
  language: { type: 'string', description: '语言/场景标识（速选默认组合），可用枚举（FE-04 §1）：Java/Maven（jar）、Java/Maven（容器）、Java/Gradle、Java/Android、JavaScript/npm、JavaScript/npm（容器）、Python/PyInstaller、Python/其他（setuptools 等）、Go——TS/JS/Node 一律用 JavaScript/npm（环境锚点）；禁止自造枚举值' },
  steps: {
    type: 'array',
    description: '构建步骤（原样透传，最高优先）[{module_id, name, properties?, enable?}]',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        module_id: { type: 'string', description: '全限定名' },
        name: { type: 'string' },
        properties: { type: 'object', additionalProperties: true },
        enable: { type: 'boolean' },
      },
    },
  },
  scms: { type: 'array', description: '代码源 [{scm_type, repo_id, repo_name, branch, url}]；scm_type 仅支持 codehub（CodeArtsRepo），repo_id/url 取自建仓返回或已有任务回读，禁止臆造' },
  parameters: { type: 'array', description: '自定义参数双层结构' },
  description: { type: 'string', description: '任务描述' },
  flavor: { type: 'string', description: '执行机规格，当前仅支持 DEFAULT（缺省即 DEFAULT）；禁止臆造其他值' },
  hostType: { type: 'string', description: '主机类型' },
  buildConfigType: { type: 'string', description: '构建配置类型（YAML/ACTION）' },
  sourceCode: { type: 'string', description: '代码源类型（pipeline/codeci）' },
  buildIfCodeUpdated: { type: 'boolean', description: '提交代码触发构建开关' },
  autoUpdateSubModule: { type: 'string', description: '自动更新子模块' },
  agencyUrn: { type: 'string', description: '委托 urn' },
  groupId: { type: 'string', description: '任务分组 ID' },
};

/** list_projects 参数（无） */
export const listProjectsParameters: Record<string, unknown> = {};

/** list_jobs 参数（契约 §2.2） */
export const listJobsParameters: Record<string, unknown> = {
  pageIndex: { type: 'integer', description: '分页页码（≥0）' },
  pageSize: { type: 'integer', description: '每页条数（≤100）' },
  search: { type: 'string', description: '按任务名称关键字搜索' },
  buildStatus: { type: 'string', description: '构建状态过滤', enum: ['aborted', 'InQueue', 'building', 'red', 'blue', 'none'] },
  sortField: { type: 'string', description: '排序字段' },
  sortOrder: { type: 'string', description: '排序方式' },
  creatorId: { type: 'string', description: '创建者用户 ID' },
};

/** get_job 参数（契约 §2.3） */
export const getJobParameters: Record<string, unknown> = {
  jobId: { type: 'string', description: '构建任务 ID', required: true },
  getAllParams: { type: 'string', description: '是否返回完整参数' },
};

/** update_job 参数（契约 §2.5） */
export const updateJobParameters: Record<string, unknown> = {
  jobId: { type: 'string', description: '构建任务 ID', required: true },
  body: { type: 'object', additionalProperties: true, description: '与 create_job 同构的全量配置片段（含 arch/projectId/jobName/steps）', required: true },
};

/** delete_job 参数（契约 §2.6） */
export const deleteJobParameters: Record<string, unknown> = {
  jobId: { type: 'string', description: '构建任务 ID（删除不可逆）', required: true },
};

/** run_job 参数（契约 §2.7） */
export const runJobParameters: Record<string, unknown> = {
  jobId: { type: 'string', description: '构建任务 ID', required: true },
  parameter: {
    type: 'array',
    description: '参数覆盖 [{name, value}]（单数 parameter）',
    items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, value: { type: 'string' } } },
  },
  scm: { type: 'object', additionalProperties: true, description: '仓库信息（build_commit_id/build_tag）' },
};

/** stop_job 参数（契约 §2.8） */
export const stopJobParameters: Record<string, unknown> = {
  jobId: { type: 'string', description: '构建任务 ID', required: true },
  buildNo: { type: 'integer', description: '构建编号（≥1）', required: true },
};

/** get_status 参数（契约 §2.9） */
export const getStatusParameters: Record<string, unknown> = {
  jobId: { type: 'string', description: '构建任务 ID', required: true },
  buildNo: { type: 'integer', description: '构建编号', required: true },
};

/** list_records 参数（契约 §2.10） */
export const listRecordsParameters: Record<string, unknown> = {
  buildProjectId: { type: 'string', description: '项目 ID（36 位 UUID，= list_jobs 的 build_project_id）' },
  page: { type: 'integer', description: '分页页码（≥0）' },
  limit: { type: 'integer', description: '每页条数（1~100）' },
  triggers: { type: 'array', description: '触发类型过滤', items: { type: 'string' } },
  branches: { type: 'array', description: '分支列表过滤', items: { type: 'string' } },
  tags: { type: 'array', description: '标签过滤', items: { type: 'string' } },
  fromDate: { type: 'string', description: '起始时间' },
  toDate: { type: 'string', description: '结束时间' },
};

/** get_record 参数（契约 §2.11） */
export const getRecordParameters: Record<string, unknown> = {
  jobId: { type: 'string', description: '构建任务 ID', required: true },
  buildNo: { type: 'integer', description: '构建编号', required: true },
};

/** list_artifacts 参数（契约 §2.12） */
export const listArtifactsParameters: Record<string, unknown> = {
  jobId: { type: 'string', description: '构建任务 ID', required: true },
  buildNo: { type: 'integer', description: '构建编号', required: true },
};

/** list_templates 参数（契约 §2.13） */
export const listTemplatesParameters: Record<string, unknown> = {
  name: { type: 'string', description: '模板名称模糊查询' },
  page: { type: 'integer', description: '页码（≥0）' },
  pageSize: { type: 'integer', description: '每页条数（1~100）' },
};

/** wait_build 参数（契约 §2.14） */
export const waitBuildParameters: Record<string, unknown> = {
  jobId: { type: 'string', description: '构建任务 ID', required: true },
  buildNo: { type: 'integer', description: '构建编号', required: true },
  intervalMs: { type: 'integer', description: '初始轮询间隔（2000~120000）' },
  timeoutMs: { type: 'integer', description: '总超时（60000~7200000）' },
  maxBackoffMs: { type: 'integer', description: '退避上限' },
};

/** get_log 参数（契约 §2.15） */
export const getLogParameters: Record<string, unknown> = {
  recordId: { type: 'string', description: '记录 ID（36 位 UUID，来自 get_record）', required: true },
  logLevel: { type: 'string', description: '日志等级', enum: ['INFO', 'DEBUG'] },
  maxBytes: { type: 'integer', description: '日志截断上限（默认 262144）' },
  compress: { type: 'boolean', description: '是否压缩日志' },
};

/** repo_build 参数（契约 §2.16） */
export const repoBuildParameters: Record<string, unknown> = {
  repoPath: { type: 'string', description: '本地仓库地址', required: true },
  repoType: { type: 'string', description: '仓库类型（缺省自动探测）' },
  buildCommandHint: { type: 'string', description: '参考编译命令' },
  timeoutMs: { type: 'integer', description: '超时（默认 1800000）' },
};

/** repo_prepare 参数（FE-08 §5，2026-09-28 自 repo_push 瘦身改名） */
export const repoPrepareParameters: Record<string, unknown> = {
  repoPath: { type: 'string', description: '本地 git 仓库绝对路径', required: true },
  projectUuid: { type: 'string', description: '目标项目 UUID（32 位小写数字字母，来自 list_projects 的 identifier）', required: true },
  repoName: { type: 'string', description: 'CodeArtsRepo 仓库名（默认取目录名）' },
  branch: { type: 'string', description: '推送分支（默认 master；push 由模型执行时使用）' },
};

/** 通用导出（供 tools/index.ts 组装 InternalToolDef） */
export const TOOL_PARAMETERS: Record<string, Record<string, unknown>> = {
  codeartsbuild_create_job: createJobParameters,
  codeartsbuild_list_projects: listProjectsParameters,
  codeartsbuild_list_jobs: listJobsParameters,
  codeartsbuild_get_job: getJobParameters,
  codeartsbuild_update_job: updateJobParameters,
  codeartsbuild_delete_job: deleteJobParameters,
  codeartsbuild_run_job: runJobParameters,
  codeartsbuild_stop_job: stopJobParameters,
  codeartsbuild_get_status: getStatusParameters,
  codeartsbuild_list_records: listRecordsParameters,
  codeartsbuild_get_record: getRecordParameters,
  codeartsbuild_list_artifacts: listArtifactsParameters,
  codeartsbuild_list_templates: listTemplatesParameters,
  codeartsbuild_wait_build: waitBuildParameters,
  codeartsbuild_get_log: getLogParameters,
  codeartsbuild_repo_build: repoBuildParameters,
  codeartsbuild_repo_prepare: repoPrepareParameters,
};

export type { InternalToolDef };
