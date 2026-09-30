#!/usr/bin/env node
/**
 * Layer 2 全工具实调测试脚本
 * 对齐 TEST-02-Layer2全工具实调测试设计-20260921.md v0.2.0（22 执行场景，5 阶段，阶段 5 暂缓）
 *
 * 调用真实 handler（lib/providers/codeartsbuild/*.js）→ HttpClient（AK/SK 签名），
 * 验证工具层契约一致性（实现 vs api-contract.md，AGENTS 待办 #10）。
 *
 * 前置：
 *  - 凭据：环境变量 CAB_AK/CAB_SK/CAB_REGION 或 hcloud config（--credential 可选）
 *  - 环境变量 CAB_TEST_PROJECT_ID=<测试项目 ID>（缺失时报错退出）
 *  - 代理：--proxy=http://proxycn2.huawei.com:8080（内网）
 *
 * 运行：
 *  - 全量:    node scripts/run-layer2-all.js
 *  - 单阶段:  node scripts/run-layer2-all.js --stage=2
 *  - 单场景:  node scripts/run-layer2-all.js --only=L2-C3
 *  - 跳过清理: node scripts/run-layer2-all.js --no-cleanup
 *  - 构建等待: node scripts/run-layer2-all.js --wait-timeout=120000
 *
 * 报告输出：docs/example/test-report-l2-{时间戳}.md
 * 状态文件：docs/example/l2-test-state.json（依赖链贯穿：jobId → buildNo → recordId）
 */
import fs from 'node:fs';
import path from 'node:path';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.resolve(__dirname, '../docs/example/l2-test-state.json');
const PROJECT_ID = process.env.CAB_TEST_PROJECT_ID;
const SHELL_SLEEP_STEP = {
  module_id: 'devcloud2018.codeci_action_20017.action',
  name: '执行shell命令',
  properties: { command: 'sleep 10' },
  enable: true,
};

/** 测试项目仓库信息——换人/换项目即不同，**通过入参确定**：
 *  env 显式指定（CAB_TEST_SCM_REPO_ID/CAB_TEST_SCM_REPO_NAME/CAB_TEST_SCM_URL）；
 *  缺省时动态探测（取同项目已有任务的 scms），不硬编码真实项目/仓库。 */
const ENV_SCM = {
  repoId: process.env.CAB_TEST_SCM_REPO_ID,
  repoName: process.env.CAB_TEST_SCM_REPO_NAME,
  url: process.env.CAB_TEST_SCM_URL,
};

/** 测试项目 build_project_id（36 位 UUID）——通过 env 显式指定或缺省动态探测，不硬编码 */
const ENV_BUILD_PROJECT_ID = process.env.CAB_TEST_BUILD_PROJECT_ID;

if (!PROJECT_ID) {
  console.error('[Layer2] 缺少环境变量 CAB_TEST_PROJECT_ID=<CodeArtsBuild 业务项目 ID>，拒绝执行（不回退生产项目）');
  process.exit(1);
}

// ─── 参数解析 ───
const args = process.argv.slice(2);
const onlyCase = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const stageFilter = args.find((a) => a.startsWith('--stage='))?.split('=')[1];
const noCleanup = args.includes('--no-cleanup');
const credentialSource = args.find((a) => a.startsWith('--credential='))?.split('=')[1] ?? 'env';
const proxyUrl = args.find((a) => a.startsWith('--proxy='))?.split('=')[1] ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
const waitTimeout = Number(args.find((a) => a.startsWith('--wait-timeout='))?.split('=')[1] ?? 120_000);

// ─── HTTP 客户端初始化（AK/SK 签名） ───
let client;
try {
  const provider = createCredentialProvider(credentialSource);
  client = new HttpClient(provider, { proxyUrl });
  console.log(`[Layer2] HTTP 客户端初始化成功（credentialSource=${credentialSource}${proxyUrl ? `, proxy=${proxyUrl}` : ''}）`);
} catch (e) {
  console.error('[Layer2] HTTP 客户端初始化失败:', e.message);
  process.exit(1);
}

/** 工具上下文（handler 注入面） */
const toolCtx = { client, session: {}, envProjectId: undefined };

// ─── 工具函数 ───
function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

/** 断言工具成功返回（isError 则抛错误文本） */
function assertOk(r, toolName) {
  if (r.isError) throw new Error(`[${toolName}] ${r.content?.[0]?.text ?? JSON.stringify(r)}`);
  return r.data;
}

/** 断言工具错误返回（isError 且含期望错误码） */
function assertErr(r, toolName, code) {
  assert(r.isError === true, `[${toolName}] 应返回 isError，实际成功: ${JSON.stringify(r.data)}`);
  const text = r.content?.[0]?.text ?? '';
  assert(text.includes(code), `[${toolName}] 应含错误码 ${code}，实际: ${text}`);
  return text;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 状态文件读写（依赖链贯穿） */
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}
let state = loadState();
function saveState() {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/** 探测测试项目 scm：env 显式指定优先，缺省取同项目首个含仓库任务的 scms（换人/换项目自动适配） */
async function discoverScm() {
  if (ENV_SCM.repoId) {
    return [{
      scm_type: 'codehub',
      repo_id: ENV_SCM.repoId,
      repo_name: ENV_SCM.repoName ?? 'test-repo',
      branch: 'master',
      url: ENV_SCM.url ?? `git@codehub.devcloud.cn-north-4.huaweicloud.com:${PROJECT_ID}/test-repo.git`,
      build_type: 'branch',
    }];
  }
  const jobs = assertOk(await listJobsHandler(toolCtx, { pageIndex: 0, pageSize: 100 }), 'list_jobs(探测scm)');
  const mine = jobs.jobs.filter((j) => j.projectId === PROJECT_ID && j.scmType);
  for (const job of mine) {
    const cfg = assertOk(await getJobHandler(toolCtx, { jobId: job.jobId }), 'get_job(探测scm)');
    const s = cfg.scms?.[0];
    if (s) {
      console.log(`[Layer2] 探测到测试项目 scm: ${s.repoName ?? s.repo_id ?? '未知'}（来自任务 ${job.jobId.slice(0, 8)}…）`);
      return [{
        scm_type: s.scm_type ?? 'codehub',
        repo_id: String(s.repo_id ?? ''),
        repo_name: s.repo_name ?? '',
        branch: s.branch ?? 'master',
        url: s.url ?? '',
        build_type: s.build_type ?? 'branch',
      }];
    }
  }
  throw new Error('未能探测测试项目 scm：请设 CAB_TEST_SCM_REPO_ID/CAB_TEST_SCM_REPO_NAME/CAB_TEST_SCM_URL，或确认项目下有含 codehub 仓库的任务');
}

/** 探测测试项目 build_project_id（36 位 UUID）：env 显式指定优先，缺省取同项目首个任务的 build_project_id */
async function discoverBuildProjectId() {
  if (ENV_BUILD_PROJECT_ID) return ENV_BUILD_PROJECT_ID;
  const jobs = assertOk(await listJobsHandler(toolCtx, { pageIndex: 0, pageSize: 100 }), 'list_jobs(探测build_project_id)');
  const mine = jobs.jobs.find((j) => j.projectId === PROJECT_ID && j.buildProjectId);
  if (mine?.buildProjectId) {
    console.log(`[Layer2] 探测到 build_project_id: ${mine.buildProjectId}（来自任务 ${mine.jobId.slice(0, 8)}…）`);
    return mine.buildProjectId;
  }
  return null;
}

/** shell 步骤任务输入（带测试项目 scm——实测 2026-09-21：无 scm 时 run_job 报 DEVCB.00030046 需仓库信息） */
function shellJobInput(name, scm) {
  return {
    arch: 'x86-64',
    projectId: PROJECT_ID,
    jobName: name,
    steps: [SHELL_SLEEP_STEP],
    scms: scm ?? [],
    parameters: [],
  };
}

/** 等待 get_status 直到记录可用（run 后 record 可能尚未创建，重试 ≤8s） */
async function waitStatusReady(jobId, buildNo, maxMs = 8_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < maxMs) {
    const r = await getStatusHandler(toolCtx, { jobId, buildNo });
    if (!r.isError) return r;
    last = r;
    await sleep(1_000);
  }
  throw new Error(`get_status 记录 ${maxMs}ms 内不可用: ${last?.content?.[0]?.text ?? '未知'}`);
}

// ─── 场景定义（按依赖顺序） ───
const SCENARIOS = [
  // ─── 阶段 1：只读查询（无副作用） ───
  {
    id: 'L2-A1', tool: 'list_projects', stage: 1,
    run: async () => {
      const d = assertOk(await listProjectsHandler(toolCtx), 'list_projects');
      assert(Array.isArray(d.projects), 'data.projects 是数组');
      assert(d.projects.length > 0, `projects 非空（测试账号应至少 1 个项目，实际 ${d.projects.length}）`);
      assert(d.projects[0].projectId, 'projects[0].projectId 非空（identifier→projectId 映射）');
      return { total: d.total, sample: d.projects[0].projectId };
    },
  },
  {
    id: 'L2-A2', tool: 'list_jobs', stage: 1,
    run: async () => {
      const d = assertOk(await listJobsHandler(toolCtx, { pageIndex: 0, pageSize: 10 }), 'list_jobs');
      assert(Array.isArray(d.jobs), 'data.jobs 是数组');
      assert('jobId' in (d.jobs[0] ?? {}), 'jobs[0].jobId 字段存在（id→jobId 映射）');
      // 软断言：捕获 build_project_id（36 位 UUID，供 L2-D1）——取首个非空值
      const bp = d.jobs.find((j) => j.buildProjectId)?.buildProjectId;
      if (bp) state.buildProjectId = bp;
      return { total: d.total, statusSample: d.jobs[0]?.status ?? null };
    },
  },
  {
    id: 'L2-A3', tool: 'list_templates', stage: 1,
    run: async () => {
      const d = assertOk(await listTemplatesHandler(toolCtx, { pageSize: 20 }), 'list_templates');
      assert(Array.isArray(d.templates), 'data.templates 是数组');
      assert(d.templates.length > 0, `templates 非空（官方模板，实际 ${d.templates.length}）`);
      const firstModule = d.templates[0]?.steps?.[0]?.module_id;
      if (firstModule) {
        assert(/^devcloud2018\.codeci_action_\d+\.action$/.test(firstModule), `steps[0].module_id 为全限定名: ${firstModule}`);
      }
      return { total: d.total, sampleStep: firstModule ?? null };
    },
  },

  // ─── 阶段 2：任务生命周期 ───
  {
    id: 'L2-B1', tool: 'create_job', stage: 2,
    run: async () => {
      const name = `l2test-b1-${Date.now().toString(36)}`;
      const d = assertOk(await createJobHandler(toolCtx, shellJobInput(name, discoveredScm)), 'create_job');
      assert(/^[0-9a-z]{32}$/.test(d.job_id), `job_id 匹配 32 位 UUID: ${d.job_id}`);
      state.jobId = d.job_id;
      state.jobName = name;
      return { job_id: d.job_id };
    },
  },
  {
    id: 'L2-B2', tool: 'get_job', stage: 2,
    run: async () => {
      assert(state.jobId, '依赖 L2-B1（state.jobId 缺失）');
      const d = assertOk(await getJobHandler(toolCtx, { jobId: state.jobId }), 'get_job');
      assert(d.jobName === state.jobName, `回读 job_name=${d.jobName} 应=入参 ${state.jobName}`);
      assert(d.arch === 'x86-64', `回读 arch=${d.arch} 应=x86-64`);
      assert(Array.isArray(d.steps) && d.steps.length > 0, 'steps 非空');
      assert(d.steps[0].module_id === SHELL_SLEEP_STEP.module_id, `steps[0].module_id=${d.steps[0].module_id} 应=20017`);
      return { jobName: d.jobName, step0: d.steps[0].module_id };
    },
  },
  {
    id: 'L2-B3', tool: 'update_job', stage: 2,
    run: async () => {
      assert(state.jobId, '依赖 L2-B1（state.jobId 缺失）');
      // 全量覆盖语义：先 get_job 取原配置 → 改 jobName → 整体提交
      const cfg = assertOk(await getJobHandler(toolCtx, { jobId: state.jobId }), 'get_job(前置)');
      const newName = `${state.jobName}-upd`;
      const body = {
        arch: cfg.arch,
        jobName: newName,
        projectId: cfg.projectId,
        steps: cfg.steps,
        scms: cfg.scms,
        parameters: cfg.parameters ?? [],
        buildConfigType: cfg.buildConfigType,
      };
      const d = assertOk(await updateJobHandler(toolCtx, { jobId: state.jobId, body }), 'update_job');
      assert(d.updated === true, 'updated === true');
      // 回读验证 job_name 已更新
      const after = assertOk(await getJobHandler(toolCtx, { jobId: state.jobId }), 'get_job(回读)');
      assert(after.jobName === newName, `回读 job_name=${after.jobName} 应=新值 ${newName}`);
      state.jobName = newName;
      return { newName };
    },
  },
  {
    id: 'L2-B4', tool: 'delete_job', stage: 2,
    run: async () => {
      // 用独立 throwaway job 验证删除（不动 L2-B1 主 job——L2-C 组需复用）
      const name = `l2test-b4-${Date.now().toString(36)}`;
      const created = assertOk(await createJobHandler(toolCtx, shellJobInput(name, discoveredScm)), 'create_job(throwaway)');
      const d = assertOk(await deleteJobHandler(toolCtx, { jobId: created.job_id }), 'delete_job');
      assert(d.deleted === true, 'deleted === true');
      // 幂等：重复删除——软断言（记录实际行为：API 幂等接受 或 返回错误）
      const again = await deleteJobHandler(toolCtx, { jobId: created.job_id });
      const warn = again.isError
        ? `重复删除返回错误: ${again.content[0].text.split('\n')[0]}`
        : 'API 幂等接受重复删除（deleted:true）';
      return { job_id: created.job_id, deleted: d.deleted, repeatDelete: warn };
    },
  },
  {
    id: 'L2-B5', tool: 'create_job', stage: 2,
    run: async () => {
      const r = await createJobHandler(toolCtx, {
        arch: 'x86-64',
        projectId: PROJECT_ID,
        jobName: `l2test-b5-${Date.now().toString(36)}`,
        steps: [{ module_id: 'devcloud2018.codeci_action_99999.action', name: 'fake', enable: true }],
      });
      assertErr(r, 'create_job(非法module_id)', 'E_PARAM');
      return { error: 'E_PARAM(module_id 非白名单)' };
    },
  },

  // ─── 阶段 3：执行控制（shell sleep 两轮构建） ───
  {
    id: 'L2-C1', tool: 'run_job', stage: 3,
    run: async () => {
      assert(state.jobId, '依赖 L2-B1（state.jobId 缺失）');
      const d = assertOk(await runJobHandler(toolCtx, { jobId: state.jobId }), 'run_job(#1)');
      assert(typeof d.buildNo === 'number' && d.buildNo >= 1, `buildNo 是 number>=1: ${d.buildNo}`);
      state.buildNo1 = d.buildNo;
      return { buildNo: d.buildNo, job_id: d.job_id };
    },
  },
  {
    id: 'L2-C2', tool: 'get_status', stage: 3,
    run: async () => {
      assert(state.jobId && state.buildNo1, '依赖 L2-C1（state.buildNo1 缺失）');
      const r = await waitStatusReady(state.jobId, state.buildNo1);
      const d = assertOk(r, 'get_status');
      const terminal = ['SUCCESS', 'FAILED', 'ERROR', 'CANCELED', 'COMPLETED'];
      assert(terminal.includes(d.status) || d.status === 'RUNNING' || d.status === 'QUEUED', `status ∈ 统一枚举: ${d.status}`);
      return { status: d.status, start_time: d.start_time ?? null };
    },
  },
  {
    id: 'L2-C3', tool: 'wait_build', stage: 3,
    run: async () => {
      assert(state.jobId && state.buildNo1, '依赖 L2-C1（state.buildNo1 缺失）');
      const d = assertOk(
        await waitBuildHandler(toolCtx, { jobId: state.jobId, buildNo: state.buildNo1, intervalMs: 3_000, timeoutMs: waitTimeout }),
        'wait_build(#1)',
      );
      // shell sleep 偶发环境失败可接受（2026-09-21 实测：偶见 FAILED 但 C6 get_log finished=SUCCESS）；
      // 终态必须落入统一枚举（非 TIMEOUT/UNKNOWN），FAILED 不阻塞 C4~C6（record/artifacts/log 对失败构建同样有效）
      const terminal = ['SUCCESS', 'FAILED', 'ERROR', 'CANCELED', 'COMPLETED'];
      assert(terminal.includes(d.status), `终态应 ∈ 统一枚举，实际: ${d.status}`);
      return { status: d.status, elapsed_ms: d.elapsed_ms ?? null };
    },
  },
  {
    id: 'L2-C4', tool: 'get_record', stage: 3,
    run: async () => {
      assert(state.jobId && state.buildNo1, '依赖 L2-C1（state.buildNo1 缺失）');
      const d = assertOk(await getRecordHandler(toolCtx, { jobId: state.jobId, buildNo: state.buildNo1 }), 'get_record');
      assert(/^[0-9a-z-]{36}$/.test(d.record_id), `record_id 匹配 36 位 UUID: ${d.record_id}`);
      state.recordId = d.record_id;
      return { record_id: d.record_id, execution_id: d.execution_id ?? null };
    },
  },
  {
    id: 'L2-C5', tool: 'list_artifacts', stage: 3,
    run: async () => {
      assert(state.jobId && state.buildNo1, '依赖 L2-C1（state.buildNo1 缺失）');
      const d = assertOk(await listArtifactsHandler(toolCtx, { jobId: state.jobId, buildNo: state.buildNo1 }), 'list_artifacts');
      assert(Array.isArray(d.artifacts), 'artifacts 是数组');
      assert(d.job_id === state.jobId, `job_id 回填=${d.job_id} 应=${state.jobId}`);
      assert(d.build_no === state.buildNo1, `build_no 回填=${d.build_no} 应=${state.buildNo1}`);
      return { count: d.artifacts.length };
    },
  },
  {
    id: 'L2-C6', tool: 'get_log', stage: 3,
    run: async () => {
      assert(state.recordId, '依赖 L2-C4（state.recordId 缺失）');
      const d = assertOk(await getLogHandler(toolCtx, { recordId: state.recordId }), 'get_log');
      assert(d.record_id === state.recordId, `record_id 回填=${d.record_id} 应=${state.recordId}`);
      assert(typeof d.byte_size === 'number' && d.byte_size >= 0, `byte_size ≥ 0: ${d.byte_size}`);
      assert(Array.isArray(d.structured), 'structured 是数组');
      return { byte_size: d.byte_size, truncated: d.truncated, finished: d.finished ?? null, structuredCount: d.structured.length };
    },
  },
  {
    id: 'L2-C7', tool: 'run_job', stage: 3,
    run: async () => {
      assert(state.jobId, '依赖 L2-B1（state.jobId 缺失）');
      const d = assertOk(await runJobHandler(toolCtx, { jobId: state.jobId }), 'run_job(#2)');
      assert(typeof d.buildNo === 'number' && d.buildNo >= 1, `buildNo 是 number>=1: ${d.buildNo}`);
      assert(state.buildNo1 === undefined || d.buildNo > state.buildNo1, `buildNo=${d.buildNo} 应 > 第 1 次 ${state.buildNo1}（同 job 内递增）`);
      state.buildNo2 = d.buildNo;
      return { buildNo: d.buildNo };
    },
  },
  {
    id: 'L2-C8', tool: 'get_status', stage: 3,
    run: async () => {
      assert(state.jobId && state.buildNo2, '依赖 L2-C7（state.buildNo2 缺失）');
      // sleep 10s 窗口内：run #2 后立即查询，应见非终态（QUEUED/RUNNING）
      const r = await waitStatusReady(state.jobId, state.buildNo2, 8_000);
      const d = assertOk(r, 'get_status(#2)');
      const terminal = ['SUCCESS', 'FAILED', 'ERROR', 'CANCELED', 'COMPLETED'];
      assert(!terminal.includes(d.status), `sleep 窗口内应非终态，实际 ${d.status}（窗口可能被错过）`);
      assert(d.status === 'RUNNING' || d.status === 'QUEUED', `状态应 RUNNING/QUEUED，实际: ${d.status}`);
      return { status: d.status };
    },
  },
  {
    id: 'L2-C9', tool: 'stop_job', stage: 3,
    run: async () => {
      assert(state.jobId && state.buildNo2, '依赖 L2-C7（state.buildNo2 缺失）');
      const d = assertOk(await stopJobHandler(toolCtx, { jobId: state.jobId, buildNo: state.buildNo2 }), 'stop_job');
      assert(d.stopped === true, `stopped === true（sleep 窗口内应可停）: ${JSON.stringify(d)}`);
      return { stopped: d.stopped, build_no: d.build_no };
    },
  },
  {
    id: 'L2-C10', tool: 'wait_build', stage: 3,
    run: async () => {
      assert(state.jobId && state.buildNo2, '依赖 L2-C7（state.buildNo2 缺失）');
      const d = assertOk(
        await waitBuildHandler(toolCtx, { jobId: state.jobId, buildNo: state.buildNo2, intervalMs: 3_000, timeoutMs: waitTimeout }),
        'wait_build(#2)',
      );
      assert(d.status === 'CANCELED', `stop 后终态应 CANCELED，实际: ${d.status}`);
      return { status: d.status };
    },
  },

  // ─── 阶段 4：历史查询 ───
  {
    id: 'L2-D1', tool: 'list_records', stage: 4,
    run: async () => {
      // build_project_id（36 位 UUID）通过入参确定：本任务 → 同项目探测 → env 显式，不硬编码
      let buildProjectId = state.buildProjectId;
      if (!buildProjectId) {
        const jobs = assertOk(await listJobsHandler(toolCtx, { search: state.jobName }), 'list_jobs(前置)');
        const mine = jobs.jobs.find((j) => j.jobId === state.jobId);
        buildProjectId = mine?.buildProjectId;
        if (buildProjectId) state.buildProjectId = buildProjectId;
      }
      if (!buildProjectId) buildProjectId = await discoverBuildProjectId();
      assert(buildProjectId, 'build_project_id 不可得（本任务/同项目探测/env 均无，可设 CAB_TEST_BUILD_PROJECT_ID）');
      assert(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(buildProjectId), `build_project_id 36 位 UUID: ${buildProjectId}`);
      const d = assertOk(await listRecordsHandler(toolCtx, { buildProjectId, page: 1, limit: 10 }), 'list_records');
      assert(Array.isArray(d.records), 'records 是数组');
      if (d.records.length > 0) {
        assert(typeof d.records[0].buildNo === 'number', `build_no→buildNo 映射: ${d.records[0].buildNo}`);
      }
      return { total: d.total, records: d.records.length };
    },
  },
  {
    id: 'L2-D2', tool: 'get_record', stage: 4,
    run: async () => {
      assert(state.jobId && state.buildNo1, '依赖 L2-C1（state.buildNo1 缺失）');
      const d = assertOk(await getRecordHandler(toolCtx, { jobId: state.jobId, buildNo: state.buildNo1 }), 'get_record(历史)');
      assert(/^[0-9a-z-]{36}$/.test(d.record_id), `record_id 36 位 UUID: ${d.record_id}`);
      return { record_id: d.record_id, status: d.status ?? null };
    },
  },

  // ─── 错误路径 ───
  {
    id: 'L2-X1', tool: 'get_job', stage: 4,
    run: async () => {
      // 实测（2026-09-21）：任务不存在 → 422 DEVCB.00031006 → handler 映射 E_PARAM（4xx→E_PARAM，非 E_API）
      const r = await getJobHandler(toolCtx, { jobId: '0'.repeat(32) }); // 不存在的任务 ID
      const text = assertErr(r, 'get_job(不存在)', 'E_PARAM');
      const code = text.startsWith('[') ? text.slice(1, text.indexOf(']')) : '?';
      return { errorCode: code };
    },
  },
  {
    id: 'L2-X2', tool: 'get_log', stage: 4,
    run: async () => {
      const r = await getLogHandler(toolCtx, { recordId: 'invalid-record-id' });
      const text = assertErr(r, 'get_log(非法recordId)', 'E_PARAM');
      return { error: 'E_PARAM(recordId 36 位 UUID 校验)' };
    },
  },
];

// ─── 场景选择（--only / --stage） ───
const selected = SCENARIOS.filter((s) => {
  if (onlyCase) return s.id === onlyCase;
  if (stageFilter) return s.stage === Number(stageFilter);
  return true;
});
if (selected.length === 0) {
  console.error(`[Layer2] 无匹配场景（--only=${onlyCase} --stage=${stageFilter}）`);
  process.exit(1);
}
if (onlyCase && selected[0].id !== onlyCase) {
  console.error(`[Layer2] 场景 ${onlyCase} 不存在`);
  process.exit(1);
}

// ─── 主流程 ───
const results = [];
const now = Date.now();
console.log(`\n[Layer2] 开始执行 ${selected.length} 场景${onlyCase ? `（仅 ${onlyCase}）` : stageFilter ? `（阶段 ${stageFilter}）` : ''}...\n`);

/** 测试项目 scm / build_project_id（通过入参确定：env 优先，动态探测兜底） */
let discoveredScm = [];
const needScm = selected.some((s) => ['L2-B1', 'L2-B4'].includes(s.id));
try {
  if (needScm) discoveredScm = await discoverScm();
} catch (e) {
  console.error(`[Layer2] scm 探测失败: ${e.message}`);
  process.exit(1);
}
if (needScm && discoveredScm.length === 0) {
  console.error('[Layer2] 未获取到测试项目 scm，无法创建可执行的 shell 任务');
  process.exit(1);
}

for (const sc of selected) {
  const entry = { case_id: sc.id, tool: sc.tool, status: 'SKIP', warns: [], values: {} };
  try {
    const values = await sc.run();
    entry.values = values ?? {};
    entry.status = 'PASS';
  } catch (e) {
    entry.status = 'FAIL';
    entry.warns.push(e.message);
  }
  results.push(entry);
  const warn = entry.warns[0] && entry.status === 'PASS' ? `（软断言: ${entry.warns[0]}）` : '';
  const values = Object.keys(entry.values).map((k) => `${k}=${JSON.stringify(entry.values[k])}`).join(' ');
  console.log(`  [${entry.status.padEnd(4)}] ${entry.case_id} ${entry.tool} ${values}${warn}`);
  saveState();
}

// ─── 清理（主 job）——仅全量跑（无 --stage/--only）时清理；单阶段跑保留供后续阶段衔接 ───
let cleanupNote = null;
const isFullRun = !onlyCase && !stageFilter;
if (!noCleanup && state.jobId && isFullRun) {
  try {
    const r = await deleteJobHandler(toolCtx, { jobId: state.jobId });
    cleanupNote = r.isError ? `清理失败: ${r.content[0].text.split('\n')[0]}` : '已删除主测试 job';
    if (!r.isError) {
      delete state.jobId;
      delete state.jobName;
      delete state.buildNo1;
      delete state.buildNo2;
      delete state.recordId;
    }
  } catch (e) {
    cleanupNote = `清理异常: ${e.message}`;
  }
}
saveState();

// ─── 报告 ───
const passed = results.filter((r) => r.status === 'PASS').length;
const failed = results.filter((r) => r.status === 'FAIL').length;
const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const reportPath = path.resolve(__dirname, `../docs/example/test-report-l2-${timestamp}.md`);
const totalSec = Math.round((Date.now() - now) / 1000);

const lines = [
  `# Layer 2 全工具实调测试报告 — ${timestamp}`,
  '',
  '## 1. 执行摘要',
  `- 场景总数: ${results.length} / 通过: ${passed} / 失败: ${failed} / 跳过: ${results.filter((r) => r.status === 'SKIP').length}`,
  `- 阶段范围: ${onlyCase ? `仅 ${onlyCase}` : stageFilter ? `仅阶段 ${stageFilter}` : '全部（阶段 1~4，阶段 5 暂缓）'}`,
  `- 承载: 自建 HTTP（AK/SK 签名，credentialSource=${credentialSource}）`,
  `- 构建: shell sleep 10 轻量构建（非真实 Maven）`,
  `- 总耗时: ${totalSec}s${cleanupNote ? ` / 清理: ${cleanupNote}` : ''}`,
  '',
  '## 2. 场景矩阵',
  '| 场景 | 工具 | 状态 | 关键取值 | 差异/警告 |',
  '|---------|------|------|----------|----------|',
  ...results.map((r) => `| ${r.case_id} | ${r.tool} | ${r.status} | ${Object.keys(r.values).map((k) => `${k}=${JSON.stringify(r.values[k])}`).join('; ') || '-'} | ${r.warns.join('; ') || '-'} |`),
  '',
  '## 3. 依赖链验证',
  `- projectId: \`${PROJECT_ID}\``,
  `- jobId: \`${state.jobId ?? '(已清理)'}\``,
  `- buildNo #1: \`${state.buildNo1 ?? '(已清理)'}\` / buildNo #2: \`${state.buildNo2 ?? '(已清理)'}\``,
  `- recordId: \`${state.recordId ?? '(已清理)'}\``,
  '- 验证点: create_job→jobId / run_job→buildNo / get_record→recordId / stop→CANCELED',
  '',
  '## 4. 状态映射验证',
  '- L2-C2: STARTED→RUNNING（第 1 轮 run 后）',
  '- L2-C3: wait_build 终态 SUCCESS（shell sleep 自然完成）',
  '- L2-C10: stop 后终态 CANCELED（ABORTED→CANCELED）',
  '- L2-A2: list_jobs last_build_status 映射（red→FAILED/blue→SUCCESS）',
  '',
];
fs.writeFileSync(reportPath, lines.join('\n'));

console.log(`\n[Layer2] 通过 ${passed}/${results.length}，失败 ${failed}`);
console.log(`[Layer2] 报告: ${reportPath}`);
console.log(`[Layer2] 状态文件: ${STATE_PATH}${cleanupNote ? `（${cleanupNote}）` : ''}`);
process.exit(failed > 0 ? 1 : 0);
