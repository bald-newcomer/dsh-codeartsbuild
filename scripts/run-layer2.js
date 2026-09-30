#!/usr/bin/env node
/**
 * Layer 2 实调用测试脚本 — 验证 create_job 模板有效性与回读一致性
 * 对齐 TEST-01-模板验证测试套件设计-20260918.md §7.3（19 用例：TV-01~17 + TV-E01 + TV-E07）
 *
 * 流程（每用例）：① 组装器单测（本地） → ② CreateNewJob 实调用 → ③ ShowJobConfig 回读断言 → ④ DeleteTheJob 清理
 *
 * 承载：自建 HTTP（HttpClient + AKSKSigner 签名，见 FE-06-自建HTTP承载切换方案-20260920.md）
 *
 * 前置：
 *  - 凭据：环境变量 CAB_AK/CAB_SK/CAB_REGION（credentialSource=env，默认）或工作目录 .dsh-codearts（credentialSource=file）
 *  - 环境变量 CAB_TEST_PROJECT_ID=<测试项目 ID>（缺失时报错退出）
 *  - （不再需要 CAB_AUTH_PROJECT_ID——AK/SK 签名无 IAM token 依赖）
 *
 * 运行：
 *  - 单用例:  node scripts/run-layer2.js --only=TV-01
 *  - 全量:    node scripts/run-layer2.js
 *  - 跳过清理: node scripts/run-layer2.js --no-cleanup
 *  - 凭据源:  node scripts/run-layer2.js --credential=env|file
 *  - 代理:    node scripts/run-layer2.js --proxy=http://proxycn2.huawei.com:8080
 *
 * 报告输出：docs/example/test-report-{时间戳}.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpClient } from '../lib/infra/http-client.js';
import { createCredentialProvider } from '../lib/infra/credential-provider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../tests/fixtures/layer2');
const PROJECT_ID = process.env.CAB_TEST_PROJECT_ID;

if (!PROJECT_ID) {
  console.error('[Layer2] 缺少环境变量 CAB_TEST_PROJECT_ID=<CodeArtsBuild 业务项目 ID>，拒绝执行（不回退到生产项目）');
  process.exit(1);
}

// ─── 参数解析 ───
const args = process.argv.slice(2);
const onlyCase = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const noCleanup = args.includes('--no-cleanup');
const credentialSource = args.find((a) => a.startsWith('--credential='))?.split('=')[1] ?? 'env';
const proxyUrl = args.find((a) => a.startsWith('--proxy='))?.split('=')[1] ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;

// ─── HTTP 客户端初始化（AK/SK 签名，无 IAM token 依赖） ───
let client;
try {
  const provider = createCredentialProvider(credentialSource);
  client = new HttpClient(provider, { proxyUrl });
  console.log(`[Layer2] HTTP 客户端初始化成功（credentialSource=${credentialSource}${proxyUrl ? `, proxy=${proxyUrl}` : ''}）`);
} catch (e) {
  console.error('[Layer2] HTTP 客户端初始化失败:', e.message);
  process.exit(1);
}

// ─── 工具函数 ───
function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

/** 简化组装（对齐 template-assembler.ts 逻辑，测试脚本内联实现避免编译依赖） */
function assembleSteps(input) {
  if (input.steps && input.steps.length > 0) return input.steps;
  const tplById = new Map(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/providers/codeartsbuild/assets/step-templates.json'), 'utf8')).map((t) => [t.template_id, t]));
  const langMap = {
    'Java/Maven（jar）': ['maven-build', 'upload-release'],
    'Java/Maven（容器）': ['maven-build', 'build-image-swr'],
    'Java/Gradle': ['gradle-build', 'upload-release'],
    'Java/Android': ['android-build', 'upload-release'],
    'JavaScript/npm': ['npm-build', 'upload-release'],
    'JavaScript/npm（容器）': ['npm-build', 'build-image-swr'],
    'Python/PyInstaller': ['pyinstaller-build', 'upload-release'],
    'Python/其他（setuptools 等）': ['shell-command', 'upload-release'],
    Go: ['go-build', 'upload-release'],
    PHP: ['php-build', 'upload-release'],
    'C/C++/CMake': ['cmake-build', 'upload-release'],
    'C#/MSBuild': ['shell-command', 'upload-release'],
    'Scala/sbt': ['shell-command', 'upload-release'],
    '通用/自定义': ['shell-command'],
    纯镜像: ['build-image-swr'],
    '产物传 OBS': ['upload-obs'],
    '从 OBS 拉取': ['download-obs'],
  };
  if (input.stepsPlan && input.stepsPlan.length > 0) {
    return input.stepsPlan.map((plan) => {
      const tpl = tplById.get(plan.step);
      if (!tpl) throw new Error(`step="${plan.step}" 未匹配模板`);
      return { module_id: tpl.module_id, name: tpl.name, properties: { ...tpl.properties, ...(plan.properties ?? {}) }, enable: true };
    });
  }
  if (input.language) {
    const refs = langMap[input.language];
    if (!refs) throw new Error(`language="${input.language}" 未匹配组合`);
    return refs.map((ref) => {
      const tpl = tplById.get(ref);
      return { module_id: tpl.module_id, name: tpl.name, properties: { ...tpl.properties }, enable: true };
    });
  }
  throw new Error('steps/stepsPlan/language 三者皆无');
}

/** 断言回读与期望一致（ShowJobConfig 响应） */
function assertReadback(readback, expected) {
  const result = readback.result ?? readback;
  const steps = result.steps ?? [];
  assert(steps.length === expected.steps_count, `steps 数量 ${steps.length} != 期望 ${expected.steps_count}`);
  for (let i = 0; i < expected.steps.length; i++) {
    const exp = expected.steps[i];
    const got = steps[i];
    assert(got, `steps[${i}] 缺失`);
    assert(got.module_id === exp.module_id, `steps[${i}].module_id ${got.module_id} != 期望 ${exp.module_id}`);
    assert(got.name && got.name.trim().length > 0, `steps[${i}].name 为空`);
    for (const [k, v] of Object.entries(exp.properties_contains ?? {})) {
      const gotVal = got.properties?.[k];
      assert(gotVal !== undefined, `steps[${i}].properties.${k} 缺失`);
      if (v !== undefined && v !== null && v !== '') {
        assert(String(gotVal) === String(v), `steps[${i}].properties.${k} ${gotVal} != 期望 ${v}`);
      }
    }
  }
}

// ─── 主流程 ───
const results = [];
const fixtures = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json')).sort();

for (const file of fixtures) {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
  if (onlyCase && fixture.case_id !== onlyCase) continue;

  const scene = fixture.scene ?? fixture.case_id.toLowerCase();
  const jobName = `tplval-${scene}-${Date.now().toString(36)}`;
  const entry = { case_id: fixture.case_id, name: fixture.name, status: 'SKIP', diffs: [], job_id: null };

  try {
    // ① 组装器单测（本地）
    const steps = assembleSteps(fixture.input);
    assert(steps.length === fixture.expected.steps_count, `组装 steps ${steps.length} != 期望 ${fixture.expected.steps_count}`);

    // ② CreateNewJob 实调用（HTTP: POST /v1/job/create）
    const createResp = await client.call(
      {
        method: 'POST',
        path: '/v1/job/create',
        body: {
          arch: 'x86-64',
          project_id: PROJECT_ID,
          job_name: jobName,
          steps,
          scms: [],
          parameters: [],
          build_config_type: 'ACTION',
          build_if_code_updated: false,
          auto_update_sub_module: 'false',
        },
      },
      { idempotent: false },
    );
    const jobId = createResp.result?.job_id;
    assert(jobId, `CreateNewJob 响应缺 result.job_id`);
    entry.job_id = jobId;
    entry.job_name = jobName;

    // ③ ShowJobConfig 回读断言（HTTP: GET /v1/job/{job_id}/config）
    const readback = await client.call(
      { method: 'GET', path: `/v1/job/${jobId}/config` },
      { idempotent: true },
    );
    assertReadback(readback, fixture.expected);
    entry.status = 'PASS';

    // ④ 清理
    if (!noCleanup) {
      try {
        await client.call({ method: 'DELETE', path: `/v1/job/${jobId}/delete` }, { idempotent: true });
        entry.cleanup = 'PASS';
      } catch (e) {
        entry.cleanup = `FAIL: ${e.message}`;
        entry.diffs.push(`cleanup: ${e.message}`);
      }
    }
  } catch (e) {
    entry.status = 'FAIL';
    entry.diffs.push(e.message);
  }
  results.push(entry);
  console.log(`  [${entry.status.padEnd(4)}] ${fixture.case_id} ${fixture.name}${entry.job_name ? ` (job=${entry.job_name})` : ''}`);
}

// ─── 报告 ───
const passed = results.filter((r) => r.status === 'PASS').length;
const failed = results.filter((r) => r.status === 'FAIL').length;
const skipped = results.filter((r) => r.status === 'SKIP').length;
const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const reportPath = path.resolve(__dirname, `../docs/example/test-report-${timestamp}.md`);

const lines = [
  `# 模板验证测试报告 — ${timestamp}`,
  '',
  '## 1. 执行摘要',
  `- 总用例数: ${results.length}`,
  `- 通过: ${passed} / 失败: ${failed} / 跳过: ${skipped}`,
  `- Layer 2 通过率: ${results.length ? Math.round((passed / results.length) * 100) : 0}%`,
  `- 承载: 自建 HTTP（AK/SK 签名，credentialSource=${credentialSource}）`,
  '',
  '## 2. 用例矩阵',
  '| 用例 ID | 名称 | jobId | 状态 | 差异 |',
  '|---------|------|-------|------|------|',
  ...results.map((r) => `| ${r.case_id} | ${r.name} | ${r.job_id ?? '-'} | ${r.status} | ${r.diffs.join('; ') || '-'} |`),
  '',
  '## 3. 字段差异表',
  ...results.filter((r) => r.diffs.length).map((r) => `| ${r.case_id} | ${r.diffs.join('; ')} |`),
  '',
];
fs.writeFileSync(reportPath, lines.filter((l) => l !== undefined).join('\n'));

console.log(`\n[Layer2] 通过 ${passed}/${results.length}，失败 ${failed}，跳过 ${skipped}`);
console.log(`[Layer2] 报告: ${reportPath}`);
process.exit(failed > 0 ? 1 : 0);
