/**
 * 工具 schema 定义（schemastery）
 * 对齐 api-contract.md §2 各工具入参
 */
import schema from '@deepseek-ai/schemastery';

const z = schema;

/** create_job 输入 schema */
export const createJobSchema = z.object({
  projectId: z.string().description('项目 ID（UUID，32 位数字字母）。缺省时取会话上下文（架构 §4.3 优先级：显式 > 会话 > 配置 > 询问）；显式传入覆盖并更新上下文').required(false),
  jobName: z.string().description('任务名称（中英文/数字/下划线/连接符，长度 1~115）').required(true),
  arch: z.union([z.const('x86-64'), z.const('arm')]).description('机器架构（枚举 x86-64 / arm）').required(true),
  stepsPlan: z.array(
    z.object({
      step: z.string().description('template_id（推荐，如 "maven-build"）或 module_id（全限定名，高级）'),
      properties: z.any().description('覆盖该步默认 properties（如 command/image/file）').required(false),
    }),
  ).description('意图级步骤计划（推荐）：[{step, properties?}]，数组顺序即构建步骤顺序，properties 覆盖默认参数').required(false),
  language: z.string().description('语言/场景标识（速选默认组合）：对齐 step-templates.md §1 组合（如 "Java/Maven（jar）"、"JavaScript/npm"、"Go"）').required(false),
  steps: z.any().description('构建步骤（原样透传，高级用法，最高优先）。每项含 module_id（全限定名）+ name + properties? + enable?').required(false),
  scms: z.any().description('代码源，每项含 scm_type/repo_id/repo_name/branch/url/web_url 等').required(false),
  parameters: z.any().description('自定义参数（双层结构：[{name: "hudson.model.StringParameterDefinition", params: [{name, value}]}]）').required(false),
  description: z.string().description('任务描述').required(false),
  flavor: z.string().description('执行机规格（如 DEFAULT / 2u8g，不传用服务端默认）').required(false),
  hostType: z.string().description('主机类型（custom_host / custom_acc / devcloud，默认 devcloud）').required(false),
  buildConfigType: z.string().description('构建配置类型（YAML / ACTION，默认 ACTION）').required(false),
  sourceCode: z.string().description('代码源类型（pipeline / codeci）').required(false),
  buildIfCodeUpdated: z.boolean().description('提交代码触发构建开关（默认 false）').required(false),
  autoUpdateSubModule: z.string().description('是否自动更新子模块（false/true，默认 false）').required(false),
  agencyUrn: z.string().description('委托 urn').required(false),
  groupId: z.string().description('任务分组 ID').required(false),
});

/** create_job 工具定义 */
export const createJobTool = {
  name: 'codeartsbuild_create_job',
  description: `创建构建任务（支持模板化组装）。
入参三选一（优先级 steps > stepsPlan > language）：
① stepsPlan（推荐，意图级步骤计划）：[{step, properties?}]——step 为 step-templates.json 的 template_id（如 maven-build）或 module_id（全限定名）；数组顺序即构建步骤顺序；properties 覆盖该步默认参数。
② language（速选默认组合）：语言/场景标识（如 Java/Maven（jar）、JavaScript/npm、Go），展开为默认组合。
③ steps（原样透传，高级）：每项含 module_id（全限定名）+ name + properties?。
调用前先 repo_build 完成本地构建验证，或 list_templates 获取可用模板。arch 为必填。`,
  schema: createJobSchema,
};

// ─── 云侧工具 schema ───

/** list_projects 输入 schema（无参） */
export const listProjectsSchema = z.object({});

/** list_projects 工具定义 */
export const listProjectsTool = {
  name: 'codeartsbuild_list_projects',
  description: '列出当前用户有权限的 CodeArts 项目列表（无参）。响应 projects[].projectId 即 create_job 的 projectId。',
  schema: listProjectsSchema,
};

/** list_jobs 输入 schema */
export const listJobsSchema = z.object({
  pageIndex: z.number().description('分页页码（page_index ≥ 0，≤1e9，默认 0）').required(false),
  pageSize: z.number().description('每页条数（page_size ≤100，默认 10）').required(false),
  search: z.string().description('按任务名称关键字搜索（核心搜索字段）').required(false),
  buildStatus: z.string().description('构建状态过滤，枚举 aborted | InQueue | building | red | blue | none').required(false),
  sortField: z.string().description('排序字段').required(false),
  sortOrder: z.string().description('排序方式（ASC | DESC）').required(false),
  creatorId: z.string().description('创建者用户 ID').required(false),
});

/** list_jobs 工具定义 */
export const listJobsTool = {
  name: 'codeartsbuild_list_jobs',
  description: '列出构建任务列表（全局，不按项目过滤）。search 为核心搜索字段；响应 jobs[].jobId 即后续工具的 jobId。',
  schema: listJobsSchema,
};

/** get_job 输入 schema */
export const getJobSchema = z.object({
  jobId: z.string().description('构建任务 ID（32 位数字字母）').required(true),
  getAllParams: z.string().description('是否返回完整参数（get_all_params，true/false）').required(false),
});

/** get_job 工具定义 */
export const getJobTool = {
  name: 'codeartsbuild_get_job',
  description: '获取构建任务完整配置（steps/scms/parameters）。update_job 前必须先调用本工具取原配置（全量覆盖语义）。',
  schema: getJobSchema,
};

/** update_job 输入 schema */
export const updateJobSchema = z.object({
  jobId: z.string().description('构建任务 ID（原任务）').required(true),
  body: z.any().description('与 create_job 同构的可修改配置片段（全量覆盖，非增量）。须先 get_job 取原配置后整体修改提交；含 arch/projectId/jobName/steps 等').required(true),
});

/** update_job 工具定义 */
export const updateJobTool = {
  name: 'codeartsbuild_update_job',
  description: '更新构建任务（全量覆盖提交，非增量修改）。必须先 get_job 取原配置，修改后整体提交，禁止直接传局部片段。',
  schema: updateJobSchema,
};

/** delete_job 输入 schema */
export const deleteJobSchema = z.object({
  jobId: z.string().description('构建任务 ID（删除不可逆）').required(true),
});

/** delete_job 工具定义 */
export const deleteJobTool = {
  name: 'codeartsbuild_delete_job',
  description: '删除构建任务（不可逆，调用前必须向用户确认）。',
  schema: deleteJobSchema,
};

/** run_job 输入 schema */
export const runJobSchema = z.object({
  jobId: z.string().description('构建任务 ID（请求体 job_id）').required(true),
  parameter: z.array(
    z.object({
      name: z.string().description('参数名称（≤128）').required(true),
      value: z.string().description('参数值（≤8192）').required(true),
    }),
  ).description('参数覆盖 [{name, value}]（字段名为单数 parameter；分支经 {name:"codeBranch", value:"develop"} 指定）').required(false),
  scm: z.any().description('仓库信息（仅支持 build_commit_id / build_tag；scm.branch 服务端不支持）').required(false),
});

/** run_job 工具定义 */
export const runJobTool = {
  name: 'codeartsbuild_run_job',
  description: '触发构建任务执行，返回 buildNo（每次独立递增）。分支指定经 parameter 传（如 [{name:"codeBranch", value:"develop"}]）。',
  schema: runJobSchema,
};

/** stop_job 输入 schema */
export const stopJobSchema = z.object({
  jobId: z.string().description('构建任务 ID').required(true),
  buildNo: z.number().description('构建编号（≥1，须与 run_job 返回配对）').required(true),
});

/** stop_job 工具定义 */
export const stopJobTool = {
  name: 'codeartsbuild_stop_job',
  description: '停止运行中的构建（jobId + buildNo 须配对）。',
  schema: stopJobSchema,
};

/** get_status 输入 schema */
export const getStatusSchema = z.object({
  jobId: z.string().description('构建任务 ID').required(true),
  buildNo: z.number().description('构建编号').required(true),
});

/** get_status 工具定义 */
export const getStatusTool = {
  name: 'codeartsbuild_get_status',
  description: '查询构建状态（单次）。返回统一状态枚举 QUEUED/RUNNING/SUCCESS/FAILED/ERROR/CANCELED。持续等待用 wait_build。',
  schema: getStatusSchema,
};

/** list_records 输入 schema */
export const listRecordsSchema = z.object({
  buildProjectId: z.string().description('项目 ID（36 位 UUID，= list_jobs 返回的 build_project_id，非 32 位 project_id）。缺省取会话上下文').required(false),
  page: z.number().description('分页页码（≥0，默认 1）').required(false),
  limit: z.number().description('每页条数（1~100，默认 10）').required(false),
  triggers: z.array(z.string()).description('触发类型过滤（如 MANUAL）').required(false),
  branches: z.array(z.string()).description('分支列表过滤').required(false),
  tags: z.array(z.string()).description('标签列表过滤').required(false),
  fromDate: z.string().description('起始时间（yyyy-MM-dd HH:mm:ss）').required(false),
  toDate: z.string().description('结束时间（yyyy-MM-dd HH:mm:ss）').required(false),
});

/** list_records 工具定义 */
export const listRecordsTool = {
  name: 'codeartsbuild_list_records',
  description: '列出构建历史记录。buildProjectId 为 36 位 UUID（取自 list_jobs 的 build_project_id），非 32 位 project_id。',
  schema: listRecordsSchema,
};

/** get_record 输入 schema */
export const getRecordSchema = z.object({
  jobId: z.string().description('构建任务 ID').required(true),
  buildNo: z.number().description('构建编号').required(true),
});

/** get_record 工具定义 */
export const getRecordTool = {
  name: 'codeartsbuild_get_record',
  description: '获取构建记录详情。返回 record_id（供 get_log）、execution_id、devcloud_project_id、status。',
  schema: getRecordSchema,
};

/** list_artifacts 输入 schema */
export const listArtifactsSchema = z.object({
  jobId: z.string().description('构建任务 ID').required(true),
  buildNo: z.number().description('构建编号').required(true),
});

/** list_artifacts 工具定义 */
export const listArtifactsTool = {
  name: 'codeartsbuild_list_artifacts',
  description: '列出某次构建的产物（软件包/镜像）。返回统一结构体 artifacts[]（含 console_url 供控制台跳转，当前版本不提供下载）。',
  schema: listArtifactsSchema,
};

/** list_templates 输入 schema */
export const listTemplatesSchema = z.object({
  name: z.string().description('模板名称模糊查询（长度 1~115）').required(false),
  page: z.number().description('页码（≥0，默认 0）').required(false),
  pageSize: z.number().description('每页条数（1~100，默认 20，query 名 page_size）').required(false),
});

/** list_templates 工具定义 */
export const listTemplatesTool = {
  name: 'codeartsbuild_list_templates',
  description: '列出官方构建模板。steps[].module_id 为全限定名，可直接作为 create_job 的 steps 入参。',
  schema: listTemplatesSchema,
};

/** wait_build 输入 schema */
export const waitBuildSchema = z.object({
  jobId: z.string().description('构建任务 ID').required(true),
  buildNo: z.number().description('构建编号').required(true),
  intervalMs: z.number().description('初始轮询间隔（2000~120000，默认 10000）').required(false),
  timeoutMs: z.number().description('总超时阈值（60000~7200000，默认 1800000=30 分钟）').required(false),
  maxBackoffMs: z.number().description('退避上限（默认 30000）').required(false),
});

/** wait_build 工具定义 */
export const waitBuildTool = {
  name: 'codeartsbuild_wait_build',
  description: '轮询等待构建进入终态（SUCCESS/FAILED/ERROR/CANCELED/COMPLETED）。超时返回 status=TIMEOUT + 最后状态（非异常）。',
  schema: waitBuildSchema,
};

/** get_log 输入 schema */
export const getLogSchema = z.object({
  recordId: z.string().description('记录 ID（36 位 UUID，来自 get_record 的 record_id）').required(true),
  logLevel: z.string().description('日志等级（INFO | DEBUG，默认 INFO）').required(false),
  maxBytes: z.number().description('日志截断上限（默认 262144=256KB，范围 1KB~5MB）').required(false),
  compress: z.boolean().description('是否压缩日志（默认 false）').required(false),
});

/** get_log 工具定义 */
export const getLogTool = {
  name: 'codeartsbuild_get_log',
  description: '获取构建日志（自动解压 + 结构化清洗）。仅构建失败或用户显式要求时调用。',
  schema: getLogSchema,
};

// ─── 本地构建工具 schema ───

/** repo_build 输入 schema */
export const repoBuildSchema = z.object({
  repoPath: z.string().description('本地仓库地址（绝对路径或相对当前目录）').required(true),
  repoType: z.string().description('仓库类型（如 maven/gradle/npm/go/python/php/cmake/msbuild/docker），缺省自动探测').required(false),
  buildCommandHint: z.string().description('参考编译命令（模型已判明时传入；缺省由工具按仓库类型给出编译指导）').required(false),
  timeoutMs: z.number().description('超时（默认 1800000=30 分钟）').required(false),
});

/** repo_build 工具定义 */
export const repoBuildTool = {
  name: 'codeartsbuild_repo_build',
  description: `本地构建（探测/编译指导/执行/产物/留档 内置）。
流程：探测仓库类型 → 编译指导 → 执行编译（可传 buildCommandHint）→ 产物扫描 → 自动留档。
成功返回 recommended_steps（可直接作为 create_job 的 steps 入参）；失败返回结构化 error（模型自决修复后重试）。`,
  schema: repoBuildSchema,
};
