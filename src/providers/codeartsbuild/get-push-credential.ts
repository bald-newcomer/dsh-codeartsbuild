/**
 * codeartsbuild_get_push_credential 工具 handler
 * 对齐 FE-15 §2.1 优化（2026-10-28）：提供 push token + authedUrl，供 AI 在 pwsh 命令中复用
 *
 * 场景：AI 在 repo_push 失败后转用 pwsh 手动操作时，token 未被自动复用（会话 1d8dc38a）。
 * 本工具返回当前可用的 token + 已构造的 authedUrl + 可执行命令示例——AI 复制即可用，不自行拼 URL。
 *
 * token 来源链（复用 resolveAccessToken）：显式入参 > env CAB_CODEARTSREPO_TOKEN > .dsh-codearts 文件
 */
import { makeSuccessResult, mapToolError } from '../../infra/tool-result.js';
import { type ToolResult } from '../../core/types.js';
import { resolveAccessToken, buildAuthedUrl } from './repo-push.js';

/** 工具入参 */
export interface GetPushCredentialHandlerInput {
  /** 目标 codehub 远端地址（必填——构造 authedUrl 用） */
  remoteUrl: string;
  /** 显式 accessToken（可选——优先级最高，覆盖 env/.dsh-codearts） */
  accessToken?: string;
}

/**
 * get_push_credential 工具 handler
 * 返回 push token + authedUrl + 可执行命令示例
 */
export async function getPushCredentialHandler(input: GetPushCredentialHandlerInput): Promise<ToolResult> {
  try {
    // ① 入参校验
    if (!input.remoteUrl || input.remoteUrl.trim().length === 0) {
      return makeSuccessResult(
        { available: false, reason: 'missing_remote_url' },
        'get_push_credential: 缺少 remoteUrl——请传 repo_prepare 输出的 remote_url',
      );
    }

    // ② 解析 token（复用 resolveAccessToken：显式 > env > .dsh-codearts）
    const token = resolveAccessToken(input.accessToken);

    if (!token) {
      return makeSuccessResult(
        {
          available: false,
          reason: 'no_token',
          remote_url: input.remoteUrl,
          hint: '未配置 accessToken——请用户提供 CodeArtsRepo 访问令牌后，携带 accessToken 参数重试，或写入 .dsh-codearts 的 CAB_CODEARTSREPO_TOKEN 键',
        },
        'get_push_credential: 未配置 accessToken——请用户提供访问令牌后重试',
      );
    }

    // ③ 构造 authedUrl（private-token 用户名固定）
    const authedUrl = buildAuthedUrl(input.remoteUrl, token);

    // ④ 输出（token 不直接返回——防泄露；返回 authedUrl + 可执行命令示例）
    return makeSuccessResult(
      {
        available: true,
        remote_url: input.remoteUrl,
        // authedUrl 含 token——但这是 AI 需要拼进 pwsh 命令的，必须返回
        // 注意：authedUrl 不应出现在 _summary（人类可读摘要）中
        authed_url: authedUrl,
        username: 'private-token',
        // 可执行命令示例（AI 复制即可用）
        commands: {
          set_url_and_push: `git remote set-url origin ${authedUrl}; git -c http.sslVerify=false push -u origin master`,
          direct_push: `git -c http.sslVerify=false push ${authedUrl} master`,
        },
        hint: '已配置 accessToken——以上命令可直接用于 pwsh/bash，无需自行拼 URL。token 来源：显式入参 > env CAB_CODEARTSREPO_TOKEN > .dsh-codearts 文件',
      },
      'get_push_credential: 已获取 push 凭据——用 commands 中的命令推送，无需自行拼 URL',
    );
  } catch (e) {
    return mapToolError(e);
  }
}
