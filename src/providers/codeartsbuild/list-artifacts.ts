/**
 * codeartsbuild_list_artifacts 工具 handler
 * 对齐 api-contract.md §2.12（ShowNewOutput，GET /v1/job/{job_id}/{build_no}/output）+ artifacts.md §3
 *
 * 自建 HTTP 承载后与普通工具同构（AK/SK 签名，无 token 依赖，2026-09-20 更新，契约 §8 #2）。
 * 规范化：package_infos → artifacts[]（type=artifact）；image_infos → artifacts[]（type=image）。
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { ToolException, type ToolResult } from '../../core/types.js';
import type { CloudToolContext } from './context.js';

/** ShowNewOutput 响应（契约 §2.12 输出示例） */
interface ShowNewOutputResponse {
  result?: {
    package_infos?: Array<Record<string, unknown>>;
    image_infos?: Array<Record<string, unknown>>;
    user_properties?: Record<string, unknown>;
  };
}

/** 工具入参 */
export interface ListArtifactsHandlerInput {
  jobId: string;
  buildNo: number;
}

/** package_type → language 推断（FE-03-工具详细设计-20260918.md §2.11） */
const PACKAGE_TYPE_LANGUAGE: Record<string, string> = {
  jar: 'Java',
  py: 'Python',
  wheel: 'Python',
  war: 'Java',
  zip: undefined as unknown as string, // 无法推断，置空
};

/**
 * 按产物类型拼接控制台链接（架构 §12 #3 待环境对齐，best-effort）
 */
function buildConsoleUrl(type: 'artifact' | 'image', item: Record<string, unknown>): string | undefined {
  if (type === 'image') {
    // 镜像：SWR 控制台
    const org = item.swr_organization as string | undefined;
    const repo = item.name as string | undefined;
    if (org && repo) return `https://console.huaweicloud.com/swr/#/app/${org}/${repo}`;
    return undefined;
  }
  // 制品：CodeArts 制品仓库控制台
  const projectId = item.project_id as string | undefined;
  const name = item.name as string | undefined;
  const version = item.version as string | undefined;
  if (projectId && name) {
    const suffix = version ? `/${version}` : '';
    return `https://console.huaweicloud.com/codearts/artifact/#/repository/${projectId}/${name}${suffix}`;
  }
  return undefined;
}

/** 条目 → 统一产物结构体（artifacts.md §1） */
function toArtifact(type: 'artifact' | 'image', item: Record<string, unknown>) {
  const packageType = item.package_type as string | undefined;
  return {
    name: item.name ?? null,
    type,
    language: (type === 'artifact' ? PACKAGE_TYPE_LANGUAGE[packageType ?? ''] : undefined) ?? null,
    version: item.version ?? null,
    uri: item.uri ?? (item.swr_uri as string | undefined) ?? null,
    size_bytes: item.size_bytes ?? null,
    console_url: buildConsoleUrl(type, item),
  };
}

/**
 * list_artifacts 工具 handler
 */
export async function listArtifactsHandler(
  ctx: CloudToolContext,
  input: ListArtifactsHandlerInput,
): Promise<ToolResult> {
  try {
    // ① 业务校验
    if (!input.jobId || input.jobId.trim().length === 0) {
      throw new ToolException('E_PARAM', 'jobId 为空');
    }
    if (input.buildNo === undefined || input.buildNo < 1) {
      throw new ToolException('E_PARAM', `buildNo 非法（≥1），实际: ${input.buildNo}`);
    }

    // ② 直通 HTTP（v1 ShowNewOutput）
    const resp = await ctx.client.call<ShowNewOutputResponse>(
      { method: 'GET', path: `/v1/job/${input.jobId}/${input.buildNo}/output` },
      { idempotent: true },
    );

    // ③ 规范化：package/image 两组 → 统一结构体数组
    const result = resp.result ?? {};
    const artifacts = [
      ...(result.package_infos ?? []).map((it) => toArtifact('artifact', it)),
      ...(result.image_infos ?? []).map((it) => toArtifact('image', it)),
    ];

    return makeSuccessResult(
      {
        artifacts,
        job_id: input.jobId,
        build_no: input.buildNo,
        user_properties: result.user_properties ?? null,
      },
      `共 ${artifacts.length} 个构建产物`,
    );
  } catch (e) {
    return mapToolError(e);
  }
}
