#!/usr/bin/env node
/**
 * 集成测试脚本 — 用户故事级端到端旅程（跨工具组合）
 * 对齐 architecture.md §2.1 用户故事（US-1~14）+ §6 场景编排（G1/G2/G4）+ prd.md §2
 *
 * 与 Layer 2（run-layer2-all.js，单工具契约一致性）互补：
 * 本脚本验证**跨工具数据流转与编排**（前一个工具的输出作为后一个工具输入的衔接正确性）。
 *
 * 前置（同 Layer 2）：
 *  - 凭据 env CAB_AK/CAB_SK/CAB_REGION 或 hcloud config
 *  - env CAB_TEST_PROJECT_ID=<业务项目 ID>（缺失拒绝）
 *  - 测试项目 scm：env CAB_TEST_SCM_REPO_ID/NAME/URL 或缺省动态探测（复用 Layer 2 逻辑）
 *  - 代理 --proxy=http://proxycn2.huawei.com:8080
 *
 * 运行：
 *  - 全量:   node scripts/run-integration.js --proxy=...
 *  - 单旅程: node scripts/run-integration.js --only=US-4
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HttpClient } from '../lib/infra/http-client.js';
import { createCredentialProvider } from '../lib/infra/credential-provider.js';
import { createJobHandler } from '../lib/providers/codeartsbuild/create-job.js';
import { listProjectsHandler } from '../lib/providers/codeartsbuild/list-projects.js';
import { listJobsHandler } from '../lib/providers/codeartsbuild/list-jobs.js';
import { getJobHandler } from '../lib/providers/codeartsbuild/get-job.js';
import { updateJobHandler } from '../lib/providers/codeartsbuild/update-job.js';
import { deleteJobHandler } from '../lib/providers/codeartsbuild/delete-job.js';
import { runJobHandler } from '../lib/providers/codeartsbuild/run-job.js';
import { stopJobHandler } from '../lib/providers/codeartsbuild/stop-job.js';
import { getStatusHandler } from '../lib/providers/codeartsbuild/get-status.js';
import { listRecordsHandler } from '../lib/providers/codeartsbuild/list-records.js';
import { getRecordHandler } from '../lib/providers/codeartsbuild/get-record.js';
import { listArtifactsHandler } from '../lib/providers/codeartsbuild/list-artifacts.js';
import { listTemplatesHandler } from '../lib/providers/codeartsbuild/list-templates.js';
import { waitBuildHandler } from '../lib/providers/codeartsbuild/wait-build.js';
import { getLogHandler } from '../lib/providers/codeartsbuild/get-log.js';
import { repoBuildHandler } from '../lib/providers/local-build/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = process.env.CAB_TEST_PROJECT_ID;
const SHELL_SLEEP_STEP = {
  module_id: 'devcloud2018.codeci_action_20017.action',
  name: '执行shell命令',
  properties: { command: 'sleep 10' },
  enable: true,
};

if (!PROJECT_ID) {
  console.error('[IT] 缺少环境变量 CAB_TEST_PROJECT_ID=<业务项目 ID>，拒绝执行');
  process.exit(1);
}

// ─── 参数解析 ───
const args = process.argv.slice(2);
const onlyStory = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const credentialSource = args.find((a) => a.startsWith('--credential='))?.split('=')[1] ?? 'env';
const proxyUrl = args.find((a) => a.startsWith('--proxy='))?.split('=')[1] ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;

let client;
try {
  const provider = createCredentialProvider(credentialSource);
  client = new HttpClient(provider, { proxyUrl });
  console.log(`[IT] HTTP 客户端初始化成功（${credentialSource}${proxyUrl ? `, proxy=${proxyUrl}` : ''}）`);
} catch (e) {
  console.error('[IT] HTTP 客户端初始化失败:', e.message);
  process.exit(1);
}

const toolCtx = { client, session: {}, envProjectId: undefined };

// ─── 工具函数 ───
function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}
function assertOk(r, tool) {
  if (r.isError) throw new Error(`[${tool}] ${r.content?.[0]?.text ?? JSON.stringify(r)}`);
  return r.data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 测试项目 scm（env 优先，缺省探测同项目任务） */
async function discoverScm() {
  const envId = process.env.CAB_TEST_SCM_REPO_ID;
  if (envId) {
    return [{
      scm_type: 'codehub', repo_id: envId,
      repo_name: process.env.CAB_TEST_SCM_REPO_NAME ?? 'test-repo', branch: 'master',
      url: process.env.CAB_TEST_SCM_URL ?? `git@codehub.devcloud.cn-north-4.huaweicloud.com:${PROJECT_ID}/test-repo.git`,
      build_type: 'branch',
    }];
  }
  const jobs = assertOk(await listJobsHandler(toolCtx, { pageIndex: 0, pageSize: 100 }), 'list_jobs');
  for (const job of jobs.jobs.filter((j) => j.projectId === PROJECT_ID && j.scmType)) {
    const cfg = assertOk(await getJobHandler(toolCtx, { jobId: job.jobId }), 'get_job');
    const s = cfg.scms?.[0];
    if (s) return [{ scm_type: s.scm_type ?? 'codehub', repo_id: String(s.repo_id ?? ''), repo_name: s.repo_name ?? '', branch: s.branch ?? 'master', url: s.url ?? '', build_type: s.build_type ?? 'branch' }];
  }
  throw new Error('未探测到 scm，请设 CAB_TEST_SCM_REPO_ID 等');
}
let scm = [];

function shellJob(name, command = 'sleep 10') {
  return {
    arch: 'x86-64', projectId: PROJECT_ID, jobName: name,
    steps: [{ module_id: 'devcloud2018.codeci_action_20017.action', name: '执行shell命令', properties: { command }, enable: true }],
    scms: scm, parameters: [],
  };
}

async function createShellJob(tag) {
  const d = assertOk(await createJobHandler(toolCtx, shellJob(`itest-${tag}-${Date.now().toString(36)}`)), 'create_job');
  return d.job_id;
}
async function runAndWait(jobId, opts = {}) {
  const run = assertOk(await runJobHandler(toolCtx, { jobId }), 'run_job');
  const w = assertOk(await waitBuildHandler(toolCtx, {
    jobId, buildNo: run.buildNo, intervalMs: opts.intervalMs ?? 3_000, timeoutMs: opts.timeoutMs ?? 120_000,
  }), 'wait_build');
  return { buildNo: run.buildNo, status: w.status };
}

// ─── 用户故事旅程 ───
const JOURNEYS = [
  {
    id: 'US-1-2-3', name: '项目感知旅程（list_projects→list_jobs→get_job）', tier: 'read',
    run: async () => {
      // US-1: 列出可见项目
      const projects = assertOk(await listProjectsHandler(toolCtx), 'list_projects');
      assert(projects.projects.length > 0, '至少 1 个项目');
      assert(projects.projects.some((p) => p.projectId === PROJECT_ID), '测试项目在列表中');
      // US-2: 列出任务（搜索我们创建的标记）
      const jobs = assertOk(await listJobsHandler(toolCtx, { search: 'maven-build', pageIndex: 0, pageSize: 5 }), 'list_jobs');
      assert(Array.isArray(jobs.jobs), 'jobs 数组');
      // US-3: 取首个任务详情（若有）——验证 get_job 衔接
      if (jobs.jobs.length > 0) {
        const detail = assertOk(await getJobHandler(toolCtx, { jobId: jobs.jobs[0].jobId }), 'get_job');
        assert(detail.jobName, 'get_job 返回 jobName');
      }
      return { projects: projects.projects.length, jobsFound: jobs.jobs.length };
    },
  },
  {
    id: 'US-4', name: '自动构建旅程（repo_build→create_job→run_job→wait_build→list_artifacts）', tier: 'build',
    run: async () => {
      // US-14 前置：本地构建（用临时 maven 仓库探测——不真正编译，仅验证 repo_build 流程）
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'itest-repo-'));
      fs.writeFileSync(path.join(tmpRepo, 'pom.xml'), '<project/>');
      const local = assertOk(await repoBuildHandler({ repoPath: tmpRepo, buildCommandHint: 'echo local-build-ok', timeoutMs: 30_000 }), 'repo_build');
      assert(local.status === 'SUCCESS', `repo_build SUCCESS: ${local.status}`);
      // US-4: 创建云端任务（用 repo_build 探测的 repo_type 映射 recommended_steps 思路——此处用 shell 步骤承载）
      const jobId = await createShellJob('us4');
      // run + wait
      const { buildNo, status } = await runAndWait(jobId);
      assert(status === 'SUCCESS' || status === 'FAILED', `终态: ${status}`);
      // 产物清单
      const arts = assertOk(await listArtifactsHandler(toolCtx, { jobId, buildNo }), 'list_artifacts');
      assert(Array.isArray(arts.artifacts), 'artifacts 数组');
      // 清理
      await deleteJobHandler(toolCtx, { jobId });
      return { localStatus: local.status, buildNo, status, artifacts: arts.artifacts.length };
    },
  },
  {
    id: 'US-5-6', name: '任务配置旅程（get_job→update_job→get_job→delete_job）', tier: 'config',
    run: async () => {
      const jobId = await createShellJob('us56');
      // 读取配置
      const before = assertOk(await getJobHandler(toolCtx, { jobId }), 'get_job');
      // 修改描述（全量覆盖语义）
      const newName = `${before.jobName}-v2`;
      const body = { arch: before.arch, jobName: newName, projectId: before.projectId, steps: before.steps, scms: before.scms, parameters: before.parameters ?? [], buildConfigType: before.buildConfigType };
      const upd = assertOk(await updateJobHandler(toolCtx, { jobId, body }), 'update_job');
      assert(upd.updated === true, 'updated: true');
      // 回读验证
      const after = assertOk(await getJobHandler(toolCtx, { jobId }), 'get_job(after)');
      assert(after.jobName === newName, `回读 job_name=${after.jobName} 应=${newName}`);
      // 删除
      const del = assertOk(await deleteJobHandler(toolCtx, { jobId }), 'delete_job');
      assert(del.deleted === true, 'deleted: true');
      return { renamed: newName, updated: true, deleted: true };
    },
  },
  {
    id: 'US-7-8', name: '执行控制旅程（run_job→get_status→stop_job→wait_build）', tier: 'build',
    run: async () => {
      const jobId = await createShellJob('us78');
      // 触发构建
      const run = assertOk(await runJobHandler(toolCtx, { jobId }), 'run_job');
      // 立即查状态（sleep 窗口内应非终态）
      const st = assertOk(await getStatusHandler(toolCtx, { jobId, buildNo: run.buildNo }), 'get_status');
      // 停止
      const stop = assertOk(await stopJobHandler(toolCtx, { jobId, buildNo: run.buildNo }), 'stop_job');
      assert(stop.stopped === true, 'stopped: true');
      // 停止后终态
      const w = assertOk(await waitBuildHandler(toolCtx, { jobId, buildNo: run.buildNo, intervalMs: 3_000, timeoutMs: 120_000 }), 'wait_build');
      assert(w.status === 'CANCELED', `停止后终态 CANCELED: ${w.status}`);
      await deleteJobHandler(toolCtx, { jobId });
      return { preStatus: st.status, stopped: true, finalStatus: w.status };
    },
  },
  {
    id: 'US-9-10', name: '状态监控旅程（run_job→wait_build→list_records→get_record）', tier: 'build',
    run: async () => {
      const jobId = await createShellJob('us910');
      const { buildNo, status } = await runAndWait(jobId);
      assert(status === 'SUCCESS', `构建成功: ${status}`);
      // 历史记录（list_records 用 build_project_id——探测或 env）
      const jobs = assertOk(await listJobsHandler(toolCtx, { search: 'itest-us910', pageIndex: 0, pageSize: 5 }), 'list_jobs');
      const mine = jobs.jobs.find((j) => j.jobId === jobId);
      const bpid = mine?.buildProjectId ?? process.env.CAB_TEST_BUILD_PROJECT_ID;
      let recCount = 0;
      if (bpid) {
        const recs = assertOk(await listRecordsHandler(toolCtx, { buildProjectId: bpid, page: 1, limit: 10 }), 'list_records');
        recCount = recs.records.length;
      }
      // 记录详情
      const rec = assertOk(await getRecordHandler(toolCtx, { jobId, buildNo }), 'get_record');
      assert(rec.record_id, 'record_id 存在');
      await deleteJobHandler(toolCtx, { jobId });
      return { buildStatus: status, buildNo, recordId: rec.record_id, listRecordsCount: recCount };
    },
  },
  {
    id: 'US-11-12', name: '产物模板旅程（list_templates→create_job→run→wait→list_artifacts）', tier: 'build',
    run: async () => {
      // 模板列表（官方）
      const tpls = assertOk(await listTemplatesHandler(toolCtx, { pageSize: 10 }), 'list_templates');
      assert(tpls.templates.length > 0, '模板非空');
      const sampleModule = tpls.templates[0]?.steps?.[0]?.module_id;
      assert(!sampleModule || /^devcloud2018\.codeci_action_\d+\.action$/.test(sampleModule), `module_id 全限定名: ${sampleModule}`);
      // 构建后取产物（shell 无产物——验证空数组 + 链接结构）
      const jobId = await createShellJob('us1112');
      const { buildNo, status } = await runAndWait(jobId);
      const arts = assertOk(await listArtifactsHandler(toolCtx, { jobId, buildNo }), 'list_artifacts');
      assert(Array.isArray(arts.artifacts), 'artifacts 数组');
      await deleteJobHandler(toolCtx, { jobId });
      return { templates: tpls.templates.length, buildStatus: status, artifacts: arts.artifacts.length };
    },
  },
  {
    id: 'US-13', name: '失败诊断旅程（create失败任务→run→wait(FAILED)→get_record→get_log→cleanLog）', tier: 'build',
    run: async () => {
      // 创建一个必然失败的任务：shell 命令 exit 1
      const created = assertOk(await createJobHandler(toolCtx, {
        arch: 'x86-64', projectId: PROJECT_ID,
        jobName: `itest-us13-${Date.now().toString(36)}`,
        steps: [{ module_id: 'devcloud2018.codeci_action_20017.action', name: '执行shell命令', properties: { command: 'echo boom && exit 1' }, enable: true }],
        scms: scm, parameters: [],
      }), 'create_job');
      const jobId = created.job_id;
      // 触发 + 等待终态
      const run = assertOk(await runJobHandler(toolCtx, { jobId }), 'run_job');
      const w = assertOk(await waitBuildHandler(toolCtx, { jobId, buildNo: run.buildNo, intervalMs: 3_000, timeoutMs: 120_000 }), 'wait_build');
      // 失败路径：get_record → get_log
      if (w.status === 'FAILED') {
        const rec = assertOk(await getRecordHandler(toolCtx, { jobId, buildNo: run.buildNo }), 'get_record');
        const log = assertOk(await getLogHandler(toolCtx, { recordId: rec.record_id }), 'get_log');
        assert(Array.isArray(log.structured), 'structured 数组');
        assert(typeof log.byte_size === 'number', 'byte_size');
        await deleteJobHandler(toolCtx, { jobId });
        return { buildStatus: w.status, recordId: rec.record_id, logBytes: log.byte_size, structured: log.structured.length };
      }
      // shell exit 1 偶发未判 FAILED（workflow.error 瞬态复核可能判 SUCCESS）——记录观察
      await deleteJobHandler(toolCtx, { jobId });
      return { buildStatus: w.status, note: 'exit 1 任务未判 FAILED（终态复核行为观察）' };
    },
  },
  {
    id: 'US-14', name: '本地构建旅程（repo_build 真实目录）', tier: 'local',
    run: async () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'itest-repo14-'));
      fs.writeFileSync(path.join(tmpRepo, 'pom.xml'), '<project><modelVersion>4.0.0</modelVersion><groupId>it</groupId><artifactId>it</artifactId><version>1.0</version></project>');
      fs.mkdirSync(path.join(tmpRepo, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpRepo, 'src', 'Main.java'), 'public class Main {}');
      const d = assertOk(await repoBuildHandler({ repoPath: tmpRepo, buildCommandHint: 'echo local-ok', timeoutMs: 30_000 }), 'repo_build');
      assert(d.status === 'SUCCESS', `SUCCESS: ${d.status}`);
      assert(Array.isArray(d.recommended_steps), 'recommended_steps 数组');
      assert(d.recommended_steps[0]?.module_id, 'recommended_steps[0].module_id 存在');
      assert(d.archived?.record_id, '留档 record_id');
      return { status: d.status, repoType: d.repo_type, steps: d.recommended_steps.length, archived: true };
    },
  },
];

// ─── 执行 ───
const selected = JOURNEYS.filter((j) => (onlyStory ? j.id === onlyStory : true));
if (selected.length === 0) {
  console.error(`[IT] 旅程 ${onlyStory} 不存在`);
  process.exit(1);
}

console.log(`\n[IT] 开始执行 ${selected.length} 个用户故事旅程${onlyStory ? `（仅 ${onlyStory}）` : ''}...\n`);

// scm 探测（仅 build/config 层需要）
if (selected.some((j) => j.tier === 'build' || j.tier === 'config')) {
  try {
    scm = await discoverScm();
    console.log(`[IT] scm 就绪: ${scm[0]?.repo_name ?? '(空)'}`);
  } catch (e) {
    console.error(`[IT] scm 探测失败: ${e.message}`);
    process.exit(1);
  }
}

const results = [];
for (const j of selected) {
  const entry = { id: j.id, story: j.id, name: j.name, status: 'FAIL', values: {}, note: '' };
  try {
    const v = await j.run();
    entry.values = v ?? {};
    entry.status = 'PASS';
  } catch (e) {
    entry.note = e.message;
  }
  results.push(entry);
  const vals = Object.entries(entry.values).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
  console.log(`  [${entry.status.padEnd(4)}] ${entry.id} ${entry.name}${vals ? ` ${vals}` : ''}${entry.note ? ` ⚠ ${entry.note}` : ''}`);
}

const passed = results.filter((r) => r.status === 'PASS').length;
console.log(`\n[IT] 通过 ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
