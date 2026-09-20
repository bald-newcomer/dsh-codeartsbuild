#!/usr/bin/env node
/**
 * 批量删除构建任务（DeleteTheJob）
 *
 * 用法：
 *   node scripts/delete-jobs.mjs <jobId1> <jobId2> ...      # 按 jobId 删除
 *   node scripts/delete-jobs.mjs --prefix tplval            # 按 jobName 前缀删除（先 list_jobs 匹配）
 *
 * 环境变量：
 *   CAB_AK / CAB_SK                    AK/SK（必填）
 *   CAB_REGION                         默认 cn-north-4
 *   HTTPS_PROXY                        代理（可选）
 *   （不再需要 CAB_AUTH_PROJECT_ID——AK/SK 签名无 IAM token 依赖）
 *
 * 承载：自建 HTTP（HttpClient + AKSKSigner 签名）
 */
import { HttpClient } from '../lib/infra/http-client.js';
import { EnvCredentialProvider } from '../lib/infra/credential-provider.js';

// ─── 1. 读取配置 ───
const ak = process.env.CAB_AK ?? process.env.CLOUD_SDK_AK;
const sk = process.env.CAB_SK ?? process.env.CLOUD_SDK_SK;
const region = process.env.CAB_REGION ?? 'cn-north-4';

if (!ak || !sk) {
  console.error('[delete-jobs] 缺少 CAB_AK / CAB_SK（兼容 CLOUD_SDK_AK / CLOUD_SDK_SK）');
  process.exit(1);
}

const provider = {
  getCredentials: async () => ({ ak, sk }),
  getRegion: () => region,
};
const client = new HttpClient(provider, { proxyUrl: process.env.HTTPS_PROXY || process.env.HTTP_PROXY });

const args = process.argv.slice(2);
const prefixIdx = args.indexOf('--prefix');
const prefix = prefixIdx >= 0 ? args[prefixIdx + 1] : null;
const jobIds = prefix ? [] : args.filter((a) => !a.startsWith('--'));

if (jobIds.length === 0 && !prefix) {
  console.error('[delete-jobs] 用法: node scripts/delete-jobs.mjs <jobId...> 或 --prefix tplval');
  process.exit(1);
}

// ─── 2. 按前缀查找任务（ListJob: GET /v1/job/list） ───
async function findJobsByPrefix() {
  const jobs = [];
  let page = 1;
  while (page <= 10) {
    const resp = await client.call(
      {
        method: 'GET',
        path: '/v1/job/list',
        query: { page_index: page, page_size: 100 },
      },
      { idempotent: true },
    );
    const result = resp.result ?? resp;
    const list = result.job_list ?? result.jobs ?? resp.job_list ?? [];
    if (list.length === 0) break;
    jobs.push(...list);
    if (list.length < 100) break;
    page++;
  }
  return jobs.filter((j) => j.job_name?.startsWith(prefix) || j.jobName?.startsWith(prefix));
}

// ─── 3. 删除（DeleteTheJob: DELETE /v1/job/{job_id}/delete） ───
async function deleteOne(jobId) {
  try {
    await client.call({ method: 'DELETE', path: `/v1/job/${jobId}/delete` }, { idempotent: true });
    return { jobId, ok: true, error: null };
  } catch (e) {
    return { jobId, ok: false, error: e.message };
  }
}

const targets = [];
if (prefix) {
  console.log(`[delete-jobs] 按前缀 "${prefix}" 查找任务...`);
  const found = await findJobsByPrefix();
  console.log(`[delete-jobs] 找到 ${found.length} 个任务`);
  targets.push(...found.map((j) => j.job_id ?? j.jobId));
} else {
  targets.push(...jobIds);
}

console.log(`[delete-jobs] 待删除 ${targets.length} 个任务...`);
let ok = 0, fail = 0;
for (const jobId of targets) {
  const r = await deleteOne(jobId);
  if (r.ok) {
    ok++;
    console.log(`  [OK] ${jobId}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${jobId} -> ${r.error}`);
  }
}
console.log(`[delete-jobs] 完成: 成功 ${ok} / 失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
