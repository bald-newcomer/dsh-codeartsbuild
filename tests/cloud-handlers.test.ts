/**
 * 云侧工具 handler 单测（Layer 1，mock HttpClient，不需网络）
 * 覆盖：list_projects / list_jobs / get_job / update_job / delete_job / run_job / stop_job / get_status / list_records / get_record / list_artifacts / list_templates
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HttpClient } from '../src/infra/http-client.js';
import { ToolException } from '../src/core/types.js';
import { listProjectsHandler } from '../src/providers/codeartsbuild/list-projects.js';
import { listJobsHandler } from '../src/providers/codeartsbuild/list-jobs.js';
import { getJobHandler } from '../src/providers/codeartsbuild/get-job.js';
import { updateJobHandler } from '../src/providers/codeartsbuild/update-job.js';
import { deleteJobHandler } from '../src/providers/codeartsbuild/delete-job.js';
import { runJobHandler } from '../src/providers/codeartsbuild/run-job.js';
import { stopJobHandler } from '../src/providers/codeartsbuild/stop-job.js';
import { getStatusHandler } from '../src/providers/codeartsbuild/get-status.js';
import { listRecordsHandler } from '../src/providers/codeartsbuild/list-records.js';
import { getRecordHandler } from '../src/providers/codeartsbuild/get-record.js';
import { listArtifactsHandler } from '../src/providers/codeartsbuild/list-artifacts.js';
import { listTemplatesHandler } from '../src/providers/codeartsbuild/list-templates.js';

/** mock HttpClient.call */
function makeClient(handler: (req: unknown) => unknown) {
  return { call: vi.fn(handler) } as unknown as HttpClient;
}

/** 云侧上下文构造 */
function makeCtx(client: HttpClient, session?: { projectId?: string }) {
  return { client, session, envProjectId: undefined };
}

// ─── list_projects ───
describe('listProjectsHandler', () => {

  it('成功：identifier→projectId 映射 + total', async () => {
    const client = makeClient(() => ({
      result: { total: 1, project_info_list: [{ identifier: 'proj-1', name: '测试项目', status: null }] },
      status: 'success',
    }));
    const result = await listProjectsHandler(makeCtx(client) as never);

    expect(result.isError).toBe(false);
    const data = result.data as { total: number; projects: Array<{ projectId: string }> };
    expect(data.total).toBe(1);
    expect(data.projects[0].projectId).toBe('proj-1');
    expect(data.projects[0].name).toBe('测试项目');
  });

  it('空列表返回 total=0 + 空数组', async () => {
    const client = makeClient(() => ({ result: { project_info_list: [] } }));
    const result = await listProjectsHandler(makeCtx(client) as never);

    expect(result.data).toEqual({ total: 0, projects: [] });
  });

  it('client 抛 ToolException 透传错误码', async () => {
    const client = makeClient(() => {
      throw new ToolException('E_AUTH', '认证失败');
    });
    const result = await listProjectsHandler(makeCtx(client) as never);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_AUTH');
  });
});

// ─── list_jobs ───
describe('listJobsHandler', () => {

  it('成功：job_list→jobs + jobId 映射 + last_build_time→ISO', async () => {
    const client = makeClient(() => ({
      result: {
        total: 2,
        job_list: [
          { id: 'job-1', job_name: '任务A', last_build_time: 1727041445000, last_build_status: 'red', last_job_running_status: 'Finished' },
        ],
      },
    }));
    const result = await listJobsHandler(makeCtx(client) as never, {});

    const data = result.data as { jobs: Array<{ jobId: string; lastBuildTime: string; status: string }> };
    expect(data.jobs[0].jobId).toBe('job-1');
    expect(data.jobs[0].lastBuildTime).toBe(new Date(1727041445000).toISOString());
    expect(data.jobs[0].status).toBe('FAILED'); // red → FAILED
  });

  it('pageIndex 越界应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await listJobsHandler(makeCtx(client) as never, { pageIndex: -1 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
    expect(client.call).not.toHaveBeenCalled();
  });

  it('buildStatus 非法枚举应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await listJobsHandler(makeCtx(client) as never, { buildStatus: 'bogus' });
    expect(result.isError).toBe(true);
  });

  it('search 参数透传', async () => {
    const client = makeClient(() => ({ result: { job_list: [] } }));
    await listJobsHandler(makeCtx(client) as never, { search: 'maven' });
    const [req] = client.call.mock.calls[0] as [{ query: Record<string, string> }];
    expect(req.query.search).toBe('maven');
  });
});

// ─── get_job ───
describe('getJobHandler', () => {

  it('成功：camelCase 转换 + 保留 result 主体', async () => {
    const client = makeClient(() => ({
      result: { job_name: '任务', project_id: 'p-1', steps: [{ module_id: 'devcloud2018.codeci_action_20043.action' }] },
    }));
    const result = await getJobHandler(makeCtx(client) as never, { jobId: 'job-1' });

    const data = result.data as { jobName: string; projectId: string };
    expect(data.jobName).toBe('任务');
    expect(data.projectId).toBe('p-1');
    expect(data.steps[0].module_id).toBe('devcloud2018.codeci_action_20043.action');
  });

  it('jobId 空应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await getJobHandler(makeCtx(client) as never, { jobId: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
  });

  it('jobId 超 64 应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await getJobHandler(makeCtx(client) as never, { jobId: 'x'.repeat(65) });
    expect(result.isError).toBe(true);
  });

  it('get_all_params 透传 query', async () => {
    const client = makeClient(() => ({ result: {} }));
    await getJobHandler(makeCtx(client) as never, { jobId: 'job-1', getAllParams: 'true' });
    const [req] = client.call.mock.calls[0] as [{ query: Record<string, string>; path: string }];
    expect(req.path).toBe('/v1/job/job-1/config');
    expect(req.query.get_all_params).toBe('true');
  });
});

// ─── update_job ───
describe('updateJobHandler', () => {

  it('成功：job_id 入 body + 全量字段组装', async () => {
    const client = makeClient(() => ({ result: { job_id: 'job-1' } }));
    const session = { projectId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' };
    const result = await updateJobHandler(makeCtx(client, session) as never, {
      jobId: 'job-1',
      body: {
        jobName: '任务A',
        arch: 'x86-64',
        steps: [{ module_id: 'devcloud2018.codeci_action_20043.action', name: 'Maven构建' }],
      },
    });

    expect(result.isError).toBe(false);
    expect((result.data as { updated: boolean }).updated).toBe(true);
    const [req] = client.call.mock.calls[0] as [{ path: string; body: Record<string, unknown> }];
    expect(req.path).toBe('/v1/job/update');
    expect(req.body.job_id).toBe('job-1');
    expect(req.body.job_name).toBe('任务A');
    expect(req.body.project_id).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
  });

  it('body 为空对象应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await updateJobHandler(makeCtx(client) as never, { jobId: 'job-1', body: {} as never });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
  });

  it('body 缺核心字段应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await updateJobHandler(makeCtx(client) as never, { jobId: 'job-1', body: { jobName: 'x' } as never });
    expect(result.isError).toBe(true);
  });

  it('jobId 空应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await updateJobHandler(makeCtx(client) as never, {
      jobId: '',
      body: { jobName: 'x', arch: 'x86-64', steps: [] } as never,
    });
    expect(result.isError).toBe(true);
  });
});

// ─── delete_job ───
describe('deleteJobHandler', () => {

  it('成功：DELETE 请求 + deleted:true + job_id 回填', async () => {
    const client = makeClient(() => ({ result: { job_id: 'job-1' } }));
    const result = await deleteJobHandler(makeCtx(client) as never, { jobId: 'job-1' });

    expect((result.data as { deleted: boolean }).deleted).toBe(true);
    const [req] = client.call.mock.calls[0] as [{ method: string; path: string }];
    expect(req.method).toBe('DELETE');
    expect(req.path).toBe('/v1/job/job-1/delete');
  });

  it('响应缺 result.job_id 回填输入 jobId', async () => {
    const client = makeClient(() => ({ result: {} }));
    const result = await deleteJobHandler(makeCtx(client) as never, { jobId: 'job-2' });
    expect((result.data as { job_id: string }).job_id).toBe('job-2');
  });

  it('jobId 空应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await deleteJobHandler(makeCtx(client) as never, { jobId: '' });
    expect(result.isError).toBe(true);
  });
});

// ─── run_job ───
describe('runJobHandler', () => {

  it('成功：octopus_job_name→jobId + actual_build_number→buildNo', async () => {
    const client = makeClient(() => ({
      result: { octopus_job_name: 'job-run-1', actual_build_number: '20', daily_build_number: '20200612.20' },
    }));
    const result = await runJobHandler(makeCtx(client) as never, { jobId: 'job-1' });

    const data = result.data as { job_id: string; buildNo: number; dailyBuildNo: string };
    expect(data.job_id).toBe('job-run-1');
    expect(data.buildNo).toBe(20);
    expect(data.dailyBuildNo).toBe('20200612.20');
    const [req] = client.call.mock.calls[0] as [{ path: string; body: Record<string, unknown> }];
    expect(req.path).toBe('/v1/job/execute');
    expect(req.body.job_id).toBe('job-1');
  });

  it('响应缺 actual_build_number 应抛 E_API', async () => {
    const client = makeClient(() => ({ result: { octopus_job_name: 'x' } }));
    const result = await runJobHandler(makeCtx(client) as never, { jobId: 'job-1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_API');
  });

  it('parameter 校验：name 超 128 应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await runJobHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      parameter: [{ name: 'x'.repeat(129), value: 'v' }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
  });

  it('parameter 校验：value 缺失应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await runJobHandler(makeCtx(client) as never, {
      jobId: 'job-1',
      parameter: [{ name: 'codeBranch', value: '' } as never],
    });
    expect(result.isError).toBe(true);
  });

  it('jobId 空应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await runJobHandler(makeCtx(client) as never, { jobId: '' });
    expect(result.isError).toBe(true);
  });
});

// ─── stop_job ───
describe('stopJobHandler', () => {

  it('成功：POST + body{build_no} + 回填输出', async () => {
    const client = makeClient(() => ({ status: 'success' }));
    const result = await stopJobHandler(makeCtx(client) as never, { jobId: 'job-1', buildNo: 3 });

    const data = result.data as { stopped: boolean; build_no: number };
    expect(data.stopped).toBe(true);
    expect(data.build_no).toBe(3);
    const [req] = client.call.mock.calls[0] as [{ path: string; body: Record<string, unknown> }];
    expect(req.path).toBe('/v1/job/job-1/stop');
    expect(req.body.build_no).toBe(3);
  });

  it('buildNo < 1 应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await stopJobHandler(makeCtx(client) as never, { jobId: 'job-1', buildNo: 0 });
    expect(result.isError).toBe(true);
  });

  it('jobId 空应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await stopJobHandler(makeCtx(client) as never, { jobId: '', buildNo: 1 });
    expect(result.isError).toBe(true);
  });
});

// ─── get_status ───
describe('getStatusHandler', () => {

  it('成功：STARTED→RUNNING 映射', async () => {
    const client = makeClient(() => ({
      result: { status: 'STARTED', build_no: 5, duration: 100068, start_time: '2022-10-11T08:28:47.000+00:00', finish_time: '2022-10-11T08:30:27.000+00:00' },
    }));
    const result = await getStatusHandler(makeCtx(client) as never, { jobId: 'job-1', buildNo: 5 });

    const data = result.data as { status: string; duration_ms: number; end_time: string };
    expect(data.status).toBe('RUNNING');
    expect(data.duration_ms).toBe(100068);
    expect(data.end_time).toBe('2022-10-11T08:30:27.000+00:00');
    const [req] = client.call.mock.calls[0] as [{ path: string }];
    expect(req.path).toBe('/v1/record/job-1/5/record-info');
  });

  it('SUCCESS 直映', async () => {
    const client = makeClient(() => ({ result: { status: 'SUCCESS' } }));
    const result = await getStatusHandler(makeCtx(client) as never, { jobId: 'job-1', buildNo: 1 });
    expect((result.data as { status: string }).status).toBe('SUCCESS');
  });

  it('buildNo 非法应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await getStatusHandler(makeCtx(client) as never, { jobId: 'job-1', buildNo: 0 });
    expect(result.isError).toBe(true);
  });
});

// ─── list_records ───
describe('listRecordsHandler', () => {
  const BPID = '8597a528-068e-4bfa-a812-3c625060c007'; // 36 位 UUID

  it('成功：build_project_id path + data→records + ABORTED→CANCELED', async () => {
    const client = makeClient(() => ({
      result: {
        pagination: { page: 0, limit: 10, total: 1 },
        data: [{ id: 'rec-1', status: 'ABORTED', build_no: '2', create_time: '2024-06-26T08:25:09.000+00:00' }],
      },
    }));
    const result = await listRecordsHandler(makeCtx(client) as never, { buildProjectId: BPID });

    const data = result.data as { records: Array<{ status: string; buildNo: number }>; total: number };
    expect(data.total).toBe(1);
    expect(data.records[0].status).toBe('CANCELED');
    expect(data.records[0].buildNo).toBe(2);
    const [req] = client.call.mock.calls[0] as [{ path: string }];
    expect(req.path).toBe(`/v1/record/${BPID}/records`);
  });

  it('buildProjectId 缺省取会话上下文', async () => {
    const client = makeClient(() => ({ result: { data: [] } }));
    await listRecordsHandler(makeCtx(client, { projectId: BPID }) as never, {});
    const [req] = client.call.mock.calls[0] as [{ path: string }];
    expect(req.path).toContain(BPID);
  });

  it('buildProjectId 非法（32 位）应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await listRecordsHandler(makeCtx(client) as never, { buildProjectId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
  });

  it('buildProjectId 缺省且无会话应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await listRecordsHandler(makeCtx(client) as never, {});
    expect(result.isError).toBe(true);
  });

  it('limit 越界应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await listRecordsHandler(makeCtx(client) as never, { buildProjectId: BPID, limit: 101 });
    expect(result.isError).toBe(true);
  });

  it('branches 数组透传为重复 query key', async () => {
    const client = makeClient(() => ({ result: { data: [] } }));
    await listRecordsHandler(makeCtx(client) as never, { buildProjectId: BPID, branches: ['master', 'dev'] });
    const [req] = client.call.mock.calls[0] as [{ query: Record<string, string[]> }];
    expect(req.query.branches).toEqual(['master', 'dev']);
  });
});

// ─── get_record ───
describe('getRecordHandler', () => {

  it('成功：build_record_id→record_id 顶层映射', async () => {
    const client = makeClient(() => ({
      result: { build_record_id: '9d6169b9-022d-458c-9dc8-48cc94cc4083', execution_id: 'j_YE1bu9Z7', devcloud_project_id: 'p-1', status: 'STARTED' },
    }));
    const result = await getRecordHandler(makeCtx(client) as never, { jobId: 'job-1', buildNo: 1 });

    const data = result.data as { record_id: string; execution_id: string; devcloud_project_id: string; status: string };
    expect(data.record_id).toBe('9d6169b9-022d-458c-9dc8-48cc94cc4083');
    expect(data.execution_id).toBe('j_YE1bu9Z7');
    expect(data.devcloud_project_id).toBe('p-1');
    expect(data.status).toBe('RUNNING'); // STARTED→RUNNING
  });

  it('响应缺 build_record_id 应抛 E_API', async () => {
    const client = makeClient(() => ({ result: { status: 'SUCCESS' } }));
    const result = await getRecordHandler(makeCtx(client) as never, { jobId: 'job-1', buildNo: 1 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_API');
  });

  it('buildNo 非法应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await getRecordHandler(makeCtx(client) as never, { jobId: 'job-1', buildNo: 0 });
    expect(result.isError).toBe(true);
  });
});

// ─── list_artifacts ───
describe('listArtifactsHandler', () => {

  it('成功：package_infos→artifact + image_infos→image', async () => {
    const client = makeClient(() => ({
      result: {
        package_infos: [{ name: 'demo.jar', package_type: 'jar', version: '1.0.0', project_id: 'p-1' }],
        image_infos: [{ name: 'demo-img', swr_uri: 'swr.cn-north-4.myhuaweicloud.com/demo/demo-img:1.0.0', swr_organization: 'demo' }],
      },
    }));
    const result = await listArtifactsHandler(makeCtx(client) as never, { jobId: 'job-1', buildNo: 13 });

    const data = result.data as { artifacts: Array<{ type: string; name: string; language: string | null }> };
    expect(data.artifacts).toHaveLength(2);
    expect(data.artifacts[0].type).toBe('artifact');
    expect(data.artifacts[0].language).toBe('Java'); // jar→Java
    expect(data.artifacts[1].type).toBe('image');
    const [req] = client.call.mock.calls[0] as [{ path: string }];
    expect(req.path).toBe('/v1/job/job-1/13/output');
  });

  it('空产物返回空数组', async () => {
    const client = makeClient(() => ({ result: { package_infos: [], image_infos: [] } }));
    const result = await listArtifactsHandler(makeCtx(client) as never, { jobId: 'job-1', buildNo: 1 });
    expect((result.data as { artifacts: unknown[] }).artifacts).toEqual([]);
  });

  it('buildNo 非法应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await listArtifactsHandler(makeCtx(client) as never, { jobId: 'job-1', buildNo: 0 });
    expect(result.isError).toBe(true);
  });
});

// ─── list_templates ───
describe('listTemplatesHandler', () => {

  it('成功：items→templates + template.steps 提取到顶层（ListCustomTemplate）', async () => {
    const client = makeClient(() => ({
      result: {
        total_size: 1,
        items: [
          {
            uuid: 'u-1',
            name: 'Maven 模板',
            scope: 'custom',
            template: { steps: [{ module_id: 'devcloud2018.codeci_action_20043.action', name: 'Maven构建' }] },
          },
        ],
      },
    }));
    const result = await listTemplatesHandler(makeCtx(client) as never, {});

    const data = result.data as { templates: Array<{ name: string; steps: Array<{ module_id: string }> }>; total: number };
    expect(data.total).toBe(1);
    expect(data.templates[0].name).toBe('Maven 模板');
    expect(data.templates[0].steps[0].module_id).toBe('devcloud2018.codeci_action_20043.action');
    const [req] = client.call.mock.calls[0] as [{ path: string }];
    expect(req.path).toBe('/v1/template/custom');
  });

  it('page/pageSize/filter/tags 透传（实调确认：integer 直传）', async () => {
    const client = makeClient(() => ({ result: { items: [] } }));
    await listTemplatesHandler(makeCtx(client) as never, { page: 1, pageSize: 50, filter: 'maven', tags: 'codeci' });
    const [req] = client.call.mock.calls[0] as [{ query: Record<string, unknown> }];
    expect(req.query.page).toBe(1);
    expect(req.query.page_size).toBe(50);
    expect(req.query.filter).toBe('maven');
    expect(req.query.tags).toBe('codeci');
  });

  it('name 超 115 应抛 E_PARAM', async () => {
    const client = makeClient(() => ({}));
    const result = await listTemplatesHandler(makeCtx(client) as never, { name: 'x'.repeat(116) });
    expect(result.isError).toBe(true);
  });
});
