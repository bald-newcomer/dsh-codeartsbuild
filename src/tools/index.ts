/**
 * 工具注册聚合（dsh 适配形态）
 * 对齐 architecture.md §4.1 + dsh v0.1.1 工具契约（@deepseek-ai/dsh-tools defineTool）
 *
 * 每个工具 = { name, description, parameters(JSON Schema), handler } →
 * toDshTool() 适配为 dsh 定义（execute + output.schema + output.render）。
 */
import { createJobHandler, type CreateJobHandlerInput } from '../providers/codeartsbuild/create-job.js';
import { listProjectsHandler } from '../providers/codeartsbuild/list-projects.js';
import { listJobsHandler, type ListJobsHandlerInput } from '../providers/codeartsbuild/list-jobs.js';
import { getJobHandler, type GetJobHandlerInput } from '../providers/codeartsbuild/get-job.js';
import { updateJobHandler, type UpdateJobHandlerInput } from '../providers/codeartsbuild/update-job.js';
import { deleteJobHandler, type DeleteJobHandlerInput } from '../providers/codeartsbuild/delete-job.js';
import { runJobHandler, type RunJobHandlerInput } from '../providers/codeartsbuild/run-job.js';
import { stopJobHandler, type StopJobHandlerInput } from '../providers/codeartsbuild/stop-job.js';
import { getStatusHandler, type GetStatusHandlerInput } from '../providers/codeartsbuild/get-status.js';
import { listRecordsHandler, type ListRecordsHandlerInput } from '../providers/codeartsbuild/list-records.js';
import { getRecordHandler, type GetRecordHandlerInput } from '../providers/codeartsbuild/get-record.js';
import { listArtifactsHandler, type ListArtifactsHandlerInput } from '../providers/codeartsbuild/list-artifacts.js';
import { listTemplatesHandler, type ListTemplatesHandlerInput } from '../providers/codeartsbuild/list-templates.js';
import { waitBuildHandler, type WaitBuildHandlerInput } from '../providers/codeartsbuild/wait-build.js';
import { getLogHandler, type GetLogHandlerInput } from '../providers/codeartsbuild/get-log.js';
import { repoPrepareHandler, type RepoPrepareHandlerInput } from '../providers/codeartsbuild/repo-prepare.js';
import { repoBuildHandler, type RepoBuildHandlerInput } from '../providers/local-build/index.js';
import { toDshTool, type InternalToolDef } from './dsh-adapter.js';
import { TOOL_PARAMETERS } from './parameters.js';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

/** 云侧工具内部定义（参数 JSON Schema + handler） */
function cloudTool<TInput>(name: string, description: string, handler: InternalToolDef<TInput>['handler']): InternalToolDef<TInput> {
  return { name, description, parameters: TOOL_PARAMETERS[name] ?? {}, handler };
}

/** 全部工具定义（16 个原子工具，dsh 契约） */
export function buildTools(): ToolDefinition[] {
  // 不同工具的输入类型各异，统一为宽松 InternalToolDef（dsh execute 参数为未知 JSON）
  const defs: InternalToolDef<any>[] = [
    cloudTool<CreateJobHandlerInput>('codeartsbuild_create_job', '创建构建任务（支持模板化组装，steps/stepsPlan/language 三选一）', createJobHandler),
    cloudTool<Record<string, never>>('codeartsbuild_list_projects', '列出当前用户有权限的 CodeArts 项目', async (ctx: import('../providers/codeartsbuild/context.js').CloudToolContext) => listProjectsHandler(ctx)),
    cloudTool<ListJobsHandlerInput>('codeartsbuild_list_jobs', '列出构建任务列表（search 为核心搜索字段）', listJobsHandler),
    cloudTool<GetJobHandlerInput>('codeartsbuild_get_job', '获取构建任务完整配置（update_job 前必调）', getJobHandler),
    cloudTool<UpdateJobHandlerInput>('codeartsbuild_update_job', '更新构建任务（全量覆盖，先 get_job 取原配置）', updateJobHandler),
    cloudTool<DeleteJobHandlerInput>('codeartsbuild_delete_job', '删除构建任务（不可逆，须用户确认）', deleteJobHandler),
    cloudTool<RunJobHandlerInput>('codeartsbuild_run_job', '触发构建任务执行，返回 buildNo', runJobHandler),
    cloudTool<StopJobHandlerInput>('codeartsbuild_stop_job', '停止运行中的构建（jobId+buildNo 配对）', stopJobHandler),
    cloudTool<GetStatusHandlerInput>('codeartsbuild_get_status', '查询构建状态（单次）', getStatusHandler),
    cloudTool<ListRecordsHandlerInput>('codeartsbuild_list_records', '列出构建历史记录（buildProjectId 为 36 位 UUID）', listRecordsHandler),
    cloudTool<GetRecordHandlerInput>('codeartsbuild_get_record', '获取构建记录详情（record_id 供 get_log）', getRecordHandler),
    cloudTool<ListArtifactsHandlerInput>('codeartsbuild_list_artifacts', '列出构建产物（软件包/镜像）', listArtifactsHandler),
    cloudTool<ListTemplatesHandlerInput>('codeartsbuild_list_templates', '列出用户自定义模板（创建前检查可用模板）', listTemplatesHandler),
    cloudTool<WaitBuildHandlerInput>('codeartsbuild_wait_build', '轮询等待构建进入终态（超时返回 TIMEOUT 非异常）', waitBuildHandler),
    cloudTool<GetLogHandlerInput>('codeartsbuild_get_log', '获取构建日志（自动解压 + 结构化清洗）', getLogHandler),
    cloudTool<RepoPrepareHandlerInput>('codeartsbuild_repo_prepare', '本地 git 仓库准备 CodeArtsRepo 仓库（检测远端→建仓+回读 RepoInfo，返回 remote_url + 推送指引；实际 push 由模型用宿主命令工具执行）', repoPrepareHandler),
    {
      name: 'codeartsbuild_repo_build',
      description: '本地构建（探测/编译指导/执行/产物/留档 内置）',
      parameters: TOOL_PARAMETERS.codeartsbuild_repo_build ?? {},
      handler: repoBuildHandler as InternalToolDef<RepoBuildHandlerInput>['handler'],
      local: true,
    },
  ];
  return defs.map((d) => toDshTool(d));
}

/** 重置工具上下文（测试用） */
export { resetToolsContext } from './dsh-adapter.js';
