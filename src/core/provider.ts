/**
 * BuildProvider 接口 — 构建生命周期核心域，与具体后端解耦
 * 对齐 architecture.md §4.5
 *
 * 实现状态：当前仅 createJob 经 createJobHandler 落地（HttpClient 承载）；
 * 其余方法随工具逐个实现（见 AGENTS.md 待办）。接口保留为 Provider 演进契约。
 *
 * 命名规约（2026-09-20 设计优化）：
 * - 方法名与工具名对齐（listJobs/createJob/runJob/waitBuild...），去掉冗余 Build 前缀
 * - 类型名简洁无歧义（JobInfo 替代 BuildJobInfo）
 * - 分页参数标准化：offset/limit（替代 pageIndex/pageSize）
 * - getStatus（单查）与 waitBuild（轮询等待）不重复：底层接口不同
 *   （getStatus=ShowJobBuildRecordDetail 单值；waitBuild=ShowJobStepStatus 含 flow 子步骤详情）
 */
import type {
  ProjectInfo,
  JobInfo,
  BuildJobDetail,
  output,
  status,
  CreateJobInput,
  CreateJobResult,
  ScmInfo,
  ParameterGroup,
} from './types.js';

export interface BuildProvider {
  /**
   * 场景 A: 项目感知
   * TODO: 调用 req 接口（ShowRelatedProject v1 /v1/domain/project/related）获取项目信息
   * 当前版本：projectId 由用户提供或会话上下文（架构 §4.3），无需 Provider 级项目列表
   */
  listJobs(opts?: {
    /** 分页偏移（默认 0） */
    offset?: number;
    /** 每页条数（默认 20，上限 100） */
    limit?: number;
    /** 按名称搜索 */
    search?: string;
    /** 按构建状态过滤 */
    status?: string;
  }): Promise<{ jobs: JobInfo[]; total: number }>;
  getJob(jobId: string, opts?: { getAllParams?: boolean }): Promise<BuildJobDetail>;

  /** 场景 C: 任务编排 */
  createJob(input: CreateJobInput): Promise<CreateJobResult>;
  updateJob(jobId: string, body: Partial<CreateJobInput>): Promise<{ jobId: string; updated: true }>;
  deleteJob(jobId: string): Promise<{ jobId: string; deleted: true }>;

  /** 场景 D: 执行控制 */
  runJob(
    jobId: string,
    opts?: {
      parameter?: Array<{ name: string; value: string }>;
      scm?: Partial<ScmInfo>;
    },
  ): Promise<{ jobId: string; buildNo: number; dailyBuildNo?: string }>;
  stopJob(jobId: string, buildNo: number): Promise<{ jobId: string; buildNo: number; stopped: boolean }>;

  /** 场景 E: 状态监控 */
  /**
   * 单次查询构建状态（ShowJobBuildRecordDetail v1，返回单值 result.status）
   * 与 waitBuild 不重复：本方法单查，waitBuild 轮询等待终态
   */
  getStatus(jobId: string, buildNo: number): Promise<{
    jobId: string;
    buildNo: number;
    status: status;
    startTime?: string;
    endTime?: string;
    durationMs?: number;
  }>;
  listRecords(
    buildProjectId: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<{ records: unknown[]; total: number }>;
  getRecord(jobId: string, buildNo: number): Promise<{
    jobId: string;
    buildNo: number;
    recordId: string;
    executionId?: string;
    projectId?: string;
    status: status;
  }>;
  /**
   * 轮询等待构建终态（ShowJobStepStatus v1 含 flow 子步骤详情，指数退避 + 超时 TIMEOUT 非异常）
   * 与 getStatus 不重复：本方法内部轮询等待终态，getStatus 单次查询
   */
  waitBuild(
    jobId: string,
    buildNo: number,
    opts?: { intervalMs?: number; timeoutMs?: number; maxBackoffMs?: number },
  ): Promise<{
    jobId: string;
    buildNo: number;
    status: status;
    startTime?: string;
    endTime?: string;
  }>;

  /** 场景 F: 产物管理*/
  outputs(jobId: string, buildNo: number): Promise<{
    outputs: output[];
    jobId: string;
    buildNo: number;
  }>;

  /** 场景 G: 故障诊断 */
  getLog(
    recordId: string,
    opts?: { logLevel?: 'INFO' | 'DEBUG'; maxBytes?: number },
  ): Promise<unknown>;

  /** 模板列表 */
  listTemplates(opts?: {
    name?: string;
    offset?: number;
    limit?: number;
  }): Promise<{
    templates: unknown[];
    total: number;
  }>;
}
