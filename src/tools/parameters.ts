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
        step: { type: 'string', description: 'template_id（推荐，如 maven-build/npm-build/shell-command，见 step-templates.md 模板清单）或全限定 module_id（仅高级 steps 数组用）；优先 template_id' },
        properties: { type: 'object', additionalProperties: true, description: '覆盖该步默认参数' },
      },
    },
  },
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
  confirmEmptyScms: { type: 'boolean', description: '空 scms 创建确认（默认 false）：scms 为空时工具返回 need_confirmation 不创建，引导先 repo_prepare→repo_push 再带 scms 创建；确需无代码源任务（稍后 update_job 补 scms / 运行期 scm 覆盖）→ 用户确认后携带 true 重试' },
  parameters: { type: 'array', description: '自定义参数双层结构' },
  description: { type: 'string', description: '任务描述' },
  flavor: { type: 'string', description: '执行机规格，当前仅支持 DEFAULT（缺省即 DEFAULT）；禁止臆造其他值' },
  hostType: { type: 'string', description: '主机类型' },
  buildConfigType: { type: 'string', description: '构建配置类型（YAML/ACTION）' },
  sourceCode: { type: 'string', description: '代码源类型（pipeline/codeci）' },
  buildIfCodeUpdated: { type: 'boolean', description: '提交代码触发构建开关' },
  autoUpdateSubModule: { type: 'string', description: '自动更新子模块' },
  agencyUrn: { type: 'string', description: '委托 urn（默认空/不使用；模型不得自行填写，须用户显式提供——曾发生模型用 agencyUrn + 空 scms 绕过 scm 链路致任务无代码源）' },
  groupId: { type: 'string', description: '任务分组 ID（非空须来自 get_job 回读的已有分组或用户显式确认，禁止臆造——曾触发 422 分组不存在）' },
  projectRepoType: { type: 'string', description: '项目语言类型（FE-17 §2.1，来自 subagent build_info 的 repo_type）：python/npm/maven/go/c/cpp/rust/other；用于模板选用 mismatch 检测（python 项目传 shell-command 跑 pip 会被拦——改用 pyinstaller-build 覆盖 command）', enum: ['python', 'npm', 'maven', 'gradle', 'go', 'rust', 'c', 'cpp', 'other'] },
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
  jobId: { type: 'string', description: '构建任务 ID（先 get_job 取原配置，jobId 来自 get_job/list_jobs 返回）', required: true },
  body: { type: 'object', additionalProperties: true, description: '与 create_job 同构的全量配置片段（含 arch/projectId/jobName/steps 或 stepsPlan）；全量覆盖语义——必须先 get_job 取原配置，修改后整体提交，禁止手拼残缺 body', required: true },
};

/** delete_job 参数（契约 §2.6） */
export const deleteJobParameters: Record<string, unknown> = {
  jobId: { type: 'string', description: '构建任务 ID（删除不可逆）', required: true },
  confirm: { type: 'boolean', description: '用户显式确认删除（默认 false；true 才执行不可逆删除，须经用户确认——FE-15 机制化）' },
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
  source: { type: 'string', description: '查询来源：custom（缺省，用户自定义模板）/ official（官方模板）/ all（并行查两个）', enum: ['custom', 'official', 'all'] },
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

/** repo_prepare 参数（FE-08 §5，2026-09-28 自 repo_push 瘦身改名） */
export const repoPrepareParameters: Record<string, unknown> = {
  repoPath: { type: 'string', description: '本地 git 仓库绝对路径', required: true },
  projectUuid: { type: 'string', description: '目标项目 UUID（32 位小写数字字母，来自 list_projects 的 identifier）', required: true },
  repoName: { type: 'string', description: 'CodeArtsRepo 仓库名（默认取目录名）' },
  branch: { type: 'string', description: '推送分支（默认 master；push 由模型执行时使用）' },
};

/** repo_push 参数（FE-08 §5 形态 B：内置一次智能尝试，2026-10-10） */
export const repoPushParameters: Record<string, unknown> = {
  repoPath: { type: 'string', description: '本地 git 仓库绝对路径', required: true },
  projectUuid: { type: 'string', description: '目标项目 UUID（32 位小写数字字母，= 会话 projectId）', required: true },
  repoName: { type: 'string', description: '仓库名（默认取目录名）' },
  branch: { type: 'string', description: '推送分支（默认 master）' },
  remoteUrl: { type: 'string', description: '目标 codehub 远端地址（默认取 repo_prepare 输出 remote_url）' },
  proxyUrl: { type: 'string', description: '内网代理（默认 http://proxycn2.huawei.com:8080，可被环境覆盖）' },
  sslVerify: { type: 'boolean', description: '是否关闭 SSL 校验（默认 false=内网自签名证书）' },
  accessToken: { type: 'string', description: 'CodeArtsRepo HTTPS 访问令牌（可选，FE-15）。提供时工具自动构造 https://private-token:<TOKEN>@codehub... 一次性 push URL（git -c 进程级覆盖，不写盘/不改 origin 配置/不进输出）。令牌由用户提供（CodeArts 控制台 → 个人设置 → 代码托管 → 访问令牌），模型不得自行臆造' },
};

/** get_push_credential 参数（FE-15 §2.1 优化，2026-10-28） */
export const getPushCredentialParameters: Record<string, unknown> = {
  remoteUrl: { type: 'string', description: '目标 codehub 远端地址（必填，取 repo_prepare 输出 remote_url）', required: true },
  accessToken: { type: 'string', description: 'CodeArtsRepo HTTPS 访问令牌（可选，优先级最高；缺省时从 env CAB_CODEARTSREPO_TOKEN 或 .dsh-codearts 文件读取）' },
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
  codeartsbuild_repo_prepare: repoPrepareParameters,
  codeartsbuild_repo_push: repoPushParameters,
  codeartsbuild_get_push_credential: getPushCredentialParameters,
};

export type { InternalToolDef };
