/**
 * get_push_credential handler 单测（Layer 1，mock env/.dsh-codearts，不需网络）
 * 对齐 FE-15 §2.1 优化（2026-10-28）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPushCredentialHandler } from '../src/providers/codeartsbuild/get-push-credential.js';
import { CODEARTSREPO_TOKEN_ENV } from '../src/providers/codeartsbuild/repo-push.js';
import { DOT_DSH_CODEARTS, resetFileEnvCache } from '../src/infra/credential-provider.js';

const REMOTE_URL = 'https://codehub.devcloud.cn-north-4.huaweicloud.com/d9ef97fa845d412687496770dd9f45ae/yfinance-mcp.git';

beforeEach(() => {
  delete process.env[CODEARTSREPO_TOKEN_ENV];
  resetFileEnvCache();
});

afterEach(() => {
  delete process.env[CODEARTSREPO_TOKEN_ENV];
  resetFileEnvCache();
});

describe('getPushCredentialHandler', () => {
  it('显式 accessToken → 返回 authedUrl + 可执行命令，username=private-token', async () => {
    const result = await getPushCredentialHandler({
      remoteUrl: REMOTE_URL,
      accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky',
    });

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.available).toBe(true);
    expect(data.username).toBe('private-token');
    const authedUrl = data.authed_url as string;
    expect(authedUrl).toContain('https://private-token:TVvzeJjaVXi1QnZ6Jh5E7Cky@codehub.devcloud.cn-north-4.huaweicloud.com');
    // commands 含可执行命令
    const commands = data.commands as Record<string, string>;
    expect(commands.set_url_and_push).toContain('private-token:TVvzeJjaVXi1QnZ6Jh5E7Cky@');
    expect(commands.set_url_and_push).toContain('push');
    expect(commands.direct_push).toContain('private-token:TVvzeJjaVXi1QnZ6Jh5E7Cky@');
  });

  it('环境变量 CAB_CODEARTSREPO_TOKEN 提供 token → 返回 authedUrl', async () => {
    process.env[CODEARTSREPO_TOKEN_ENV] = 'ENV_TOKEN_12345';
    const result = await getPushCredentialHandler({ remoteUrl: REMOTE_URL });

    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.available).toBe(true);
    const authedUrl = data.authed_url as string;
    expect(authedUrl).toContain('https://private-token:ENV_TOKEN_12345@');
  });

  it('`.dsh-codearts` 文件提供 token（CAB_CODEARTSREPO_TOKEN 键）→ 返回 authedUrl', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-getcred-file-'));
    fs.writeFileSync(path.join(dir, DOT_DSH_CODEARTS), `CAB_CODEARTSREPO_TOKEN=FILE_TOKEN_67890\n`);
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const result = await getPushCredentialHandler({ remoteUrl: REMOTE_URL });
      expect(result.isError).toBe(false);
      const data = result.data as Record<string, unknown>;
      expect(data.available).toBe(true);
      const authedUrl = data.authed_url as string;
      expect(authedUrl).toContain('https://private-token:FILE_TOKEN_67890@');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('无 token（env/`.dsh-codearts` 均无）→ available:false + reason:no_token + 引导', async () => {
    // 在无 .dsh-codearts 的临时目录跑（防项目根 .dsh-codearts 泄漏 env）
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-getcred-notoken-'));
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const result = await getPushCredentialHandler({ remoteUrl: REMOTE_URL });
      expect(result.isError).toBe(false);
      const data = result.data as Record<string, unknown>;
      expect(data.available).toBe(false);
      expect(data.reason).toBe('no_token');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('缺 remoteUrl → available:false + reason:missing_remote_url', async () => {
    const result = await getPushCredentialHandler({ remoteUrl: '' });
    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.available).toBe(false);
    expect(data.reason).toBe('missing_remote_url');
  });

  it('显式 accessToken 优先于环境变量', async () => {
    process.env[CODEARTSREPO_TOKEN_ENV] = 'ENV_TOKEN_12345';
    const result = await getPushCredentialHandler({
      remoteUrl: REMOTE_URL,
      accessToken: 'EXPLICIT_TOKEN_abc',
    });
    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    const authedUrl = data.authed_url as string;
    expect(authedUrl).toContain('https://private-token:EXPLICIT_TOKEN_abc@');
    expect(authedUrl).not.toContain('ENV_TOKEN_12345');
  });

  it('SSH 远端地址（非 HTTPS）→ authedUrl 原样返回（无法注入凭据）', async () => {
    const sshUrl = 'git@codehub.devcloud.cn-north-4.huaweicloud.com:d9ef97fa/yfinance-mcp.git';
    const result = await getPushCredentialHandler({
      remoteUrl: sshUrl,
      accessToken: 'TVvzeJjaVXi1QnZ6Jh5E7Cky',
    });
    expect(result.isError).toBe(false);
    const data = result.data as Record<string, unknown>;
    expect(data.available).toBe(true);
    // SSH URL 无法注入 private-token（buildAuthedUrl 原样返回）
    const authedUrl = data.authed_url as string;
    expect(authedUrl).toBe(sshUrl);
  });
});
