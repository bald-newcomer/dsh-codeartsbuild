/**
 * CodeArtsBuild 共享类型（核心业务域，与后端无关）
 * 对齐 architecture.md §4.5 核心域接口
 */

/** 项目信息 */
export interface ProjectInfo {
  projectId: string;
  name: string;
  status?: string | null;
  authorId?: string;
  isCreator?: boolean;
}

/** 构建任务（列表项） */
export interface JobInfo {
  jobId: string;
  jobName: string;
  jobCreator?: string;
  userName?: string;
  projectId?: string;
  projectName?: string;
  lastBuildTime?: number | null;
  /** 最近构建状态（工具层映射后的统一枚举：SUCCESS/FAILED/RUNNING/QUEUED/CANCELED 等，见契约 §4） */
  status?: string | null;
  /** 底层最近运行状态（ListJob 原始：Running/Finished） */
  lastJobRunningStatus?: string | null;
  isFinished?: boolean;
  disabled?: boolean;
  scmType?: string;
  buildNumber?: string;
  /** 36 位 UUID（list_records 的 build_project_id 参数用） */
  buildProjectId?: string;
}

/** 构建任务详情（get_job） */
export interface BuildJobDetail {
  jobId: string;
  jobName: string;
  projectId: string;
  arch: string;
  steps: Step[];
  scms: ScmInfo[];
  parameters: ParameterGroup[];
  flavor?: string;
  hostType?: string;
  buildConfigType?: string;
  sourceCode?: string;
  autoUpdateSubModule?: string;
}

/** 构建步骤（create_job.steps / get_job.steps） */
export interface Step {
  /** 全限定名：devcloud2018.codeci_action_XXXXX.action */
  module_id: string;
  name: string;
  properties?: Record<string, unknown>;
  version?: string | null;
  enable?: boolean;
}

/** 代码源信息（scm） */
export interface ScmInfo {
  scmType?: string;
  repoId?: string;
  repoName?: string;
  branch?: string;
  url?: string;
  webUrl?: string;
  buildType?: string;
  buildCommitId?: string;
  buildTag?: string;
}

/** 构建参数双层结构（parameters） */
export interface ParameterGroup {
  name: string;
  params: ParameterItem[];
}

export interface ParameterItem {
  name: string;
  value: string;
}

/** 构建产物（统一结构体，按介质） */
export interface output {
  name: string;
  type: 'obs' | 'image' | 'artifact' | 'local';
  language?: string;
  recordId?: string;
  sizeBytes?: number;
  uri?: string;
  consoleUrl?: string;
}

/** 统一构建状态枚举（工具层规范化输出出口） */
export type status =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'ERROR'
  | 'CANCELED'
  | 'COMPLETED'
  | 'TIMEOUT';

/** create_job 输入（工具层入参） */
export interface CreateJobInput {
  projectId: string;
  jobName: string;
  arch: 'x86-64' | 'arm';
  stepsPlan?: StepsPlanItem[];
  language?: string;
  steps?: Step[];
  scms?: ScmInfo[];
  parameters?: ParameterGroup[];
  description?: string;
  flavor?: string;
  hostType?: string;
  buildConfigType?: string;
  sourceCode?: string;
  buildIfCodeUpdated?: boolean;
  autoUpdateSubModule?: string;
  agencyUrn?: string;
  groupId?: string;
}

/** stepsPlan 项（意图级步骤计划） */
export interface StepsPlanItem {
  /** template_id（推荐，如 "maven-build"）或 module_id（全限定名） */
  step: string;
  /** 覆盖该步默认 properties（如 command/image/file） */
  properties?: Record<string, unknown>;
}

/** create_job 输出 */
export interface CreateJobResult {
  jobId: string;
  created: true;
}

/** CreateNewJob 请求体（snake_case，发给 KooCLI/HTTP） */
export interface CreateNewJobRequest {
  arch: string;
  project_id: string;
  job_name: string;
  steps: Step[];
  scms?: ScmInfo[];
  parameters?: ParameterGroup[];
  description?: string;
  flavor?: string;
  host_type?: string;
  build_config_type?: string;
  source_code?: string;
  build_if_code_updated?: boolean;
  auto_update_sub_module?: string;
  agency_urn?: string;
  group_id?: string;
}

/** 错误返回格式（工具统一） */
export interface ToolError {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

/** 工具成功返回格式 */
export interface ToolSuccess<T = unknown> {
  content: Array<{ type: 'text'; text: string }>;
  isError?: false;
  data?: T;
}

export type ToolResult = ToolError | ToolSuccess;

/** 错误码枚举 */
export type ErrorCode =
  | 'E_CONFIG'
  | 'E_AUTH'
  | 'E_PARAM'
  | 'E_API'
  | 'E_NETWORK'
  | 'E_TIMEOUT'
  | 'E_LOG';

/** 工具错误异常（内部抛出，由 handler 骨架捕获映射） */
export class ToolException extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ToolException';
  }
}
