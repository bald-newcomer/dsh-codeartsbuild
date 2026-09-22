/**
 * codeartsbuild_run_job 工具 handler
 * 对齐 api-contract.md §2.7（ExecuteJob，POST /v1/job/execute）
 *
 * 分支指定：经 parameter 传（如 {name:"codeBranch", value:"develop"}，实测生效）；
 * scm 仅支持 build_commit_id / build_tag（KooCLI 实测，契约 §8 #4）。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { toBuildNo } from '../../infra/normalize.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** ExecuteJob 响应（契约 §2.7 输出示例） */
interface ExecuteJobResponse {
  result?: {
    octopus_job_name?: string;
    actual_build_number?: string | number;
    daily_build_number?: string;
  };
}

/** 工具入参 */
export interface RunJobHandlerInput {
  jobId: string;
  parameter?: Array<{ name: string; value: string }>;
  scm?: {
    build_commit_id?: string;
    build_tag?: string;
  };
}

/**
 * run_job 工具 handler
 */
export async function runJobHandler(ctx: CloudToolContext, input: RunJobHandlerInput): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (!input.jobId || input.jobId.trim().length === 0) {
      throw new ToolException('E_PARAM', 'jobId 为空');
    }
    for (const [i, p] of (input.parameter ?? []).entries()) {
      if (!p.name || !p.name.trim()) throw new ToolException('E_PARAM', `parameter[${i}].name 为空`);
      if (p.name.length > 128) throw new ToolException('E_PARAM', `parameter[${i}].name 超长（≤128）`);
      if (p.value === undefined || p.value === null) throw new ToolException('E_PARAM', `parameter[${i}].value 为空`);
      if (String(p.value).length > 8192) throw new ToolException('E_PARAM', `parameter[${i}].value 超长（≤8192）`);
    }

    // ② 直通 HTTP（字段名单数 parameter；scm 无 branch——契约 §8 #4）
    const resp = await ctx.client.call<ExecuteJobResponse>(
      {
        method: 'POST',
        path: '/v1/job/execute',
        body: {
          job_id: input.jobId,
          parameter: input.parameter,
          scm: input.scm,
        },
      },
      { idempotent: false },
    );

    // ③ 规范化：octopus_job_name → jobId；actual_build_number → buildNo（Number）
    const jobId = resp.result?.octopus_job_name ?? input.jobId;
    const buildNo = toBuildNo(resp.result?.actual_build_number);
    if (buildNo === undefined) {
      throw new ToolException('E_API', 'ExecuteJob 成功但响应缺 result.actual_build_number', resp);
    }

    return makeSuccessResult(
      {
        job_id: jobId,
        buildNo,
        dailyBuildNo: resp.result?.daily_build_number,
      },
      `触发构建成功: jobId=${jobId} buildNo=${buildNo}`,
    );
  } catch (e) {
    return mapToolError(e);
  }
}
