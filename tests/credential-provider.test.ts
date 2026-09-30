/**
 * credential-provider 单测（Layer 1，mock fs / env，不需网络）
 * 对齐 FE-06-自建HTTP承载切换方案-20260920.md §2.2 + architecture.md §9.1
 *
 * 凭据源：env（CAB_AK/CAB_SK/CAB_REGION）+ file（.dsh-codearts）；hcloud-config 已于 2026-09-30 移除。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  EnvCredentialProvider,
  createCredentialProvider,
  readDotDshCodearts,
  loadFileEnv,
  resetFileEnvCache,
  hasDotDshCodearts,
  DOT_DSH_CODEARTS,
} from '../src/infra/credential-provider.js';
import { ToolException } from '../src/core/types.js';

/** 明文 AK/SK（华为云格式：AK 20 位大写字母数字，SK 40 位字母数字） */
const PLAIN_AK = 'ABCDEFGHIJ1234567890';
const PLAIN_SK = 'abcdefghijklmnopqrstuvwxyz0123456789abcd';

/** 恢复环境变量快照 */
const envBackup: Record<string, string | undefined> = {};

function saveEnv(keys: string[]) {
  for (const k of keys) envBackup[k] = process.env[k];
}
function restoreEnv(keys: string[]) {
  for (const k of keys) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
}

afterEach(() => {
  restoreEnv(['CAB_AK', 'CAB_SK', 'CAB_REGION']);
  resetFileEnvCache();
});

describe('EnvCredentialProvider', () => {
  it('有 CAB_AK/CAB_SK 应返回凭据', async () => {
    saveEnv(['CAB_AK', 'CAB_SK', 'CAB_REGION']);
    process.env.CAB_AK = PLAIN_AK;
    process.env.CAB_SK = PLAIN_SK;
    process.env.CAB_REGION = 'cn-east-2';
    const provider = new EnvCredentialProvider();

    const creds = await provider.getCredentials();
    expect(creds).toEqual({ ak: PLAIN_AK, sk: PLAIN_SK });
    expect(provider.getRegion()).toBe('cn-east-2');
  });

  it('缺环境变量应抛 E_CONFIG', async () => {
    saveEnv(['CAB_AK', 'CAB_SK']);
    delete process.env.CAB_AK;
    delete process.env.CAB_SK;
    const provider = new EnvCredentialProvider();

    await expect(provider.getCredentials()).rejects.toMatchObject({ code: 'E_CONFIG' });
  });

  it('region 缺省默认 cn-north-4', async () => {
    saveEnv(['CAB_AK', 'CAB_SK', 'CAB_REGION']);
    process.env.CAB_AK = PLAIN_AK;
    process.env.CAB_SK = PLAIN_SK;
    delete process.env.CAB_REGION;
    const provider = new EnvCredentialProvider();

    expect(provider.getRegion()).toBe('cn-north-4');
  });
});

describe('createCredentialProvider 工厂', () => {
  it('显式 env 源应返回 EnvCredentialProvider', () => {
    const p = createCredentialProvider('env');
    expect(p).toBeInstanceOf(EnvCredentialProvider);
  });

  it('显式 hcloud-config 源应抛 E_CONFIG（已移除）', () => {
    expect(() => createCredentialProvider('hcloud-config' as never)).toThrow(ToolException);
  });

  it('未知源应抛 E_CONFIG', () => {
    expect(() => createCredentialProvider('unknown' as never)).toThrow(ToolException);
  });

  it('缺省且有 CAB_AK 应默认 env', () => {
    saveEnv(['CAB_AK']);
    process.env.CAB_AK = PLAIN_AK;
    const p = createCredentialProvider();
    expect(p).toBeInstanceOf(EnvCredentialProvider);
  });

  it('缺省且无 CAB_AK + cwd 无 .dsh-codearts 应抛 E_CONFIG', () => {
    saveEnv(['CAB_AK']);
    delete process.env.CAB_AK;
    // 在无 .dsh-codearts 的临时目录运行（仓库根目录可能被真实凭据文件污染）
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-provider-nofile-'));
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(() => createCredentialProvider()).toThrow(ToolException);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe('.dsh-codearts 文件源（2026-09-28）', () => {
  /** 在临时目录写 .dsh-codearts，返回目录路径 */
  function writeDotDshCodearts(content: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-dshcodearts-'));
    fs.writeFileSync(path.join(dir, DOT_DSH_CODEARTS), content);
    return dir;
  }

  it('readDotDshCodearts 应解析 key=value 行，忽略空行与 # 注释', () => {
    const dir = writeDotDshCodearts(
      `# 注释行\nCAB_AK=${PLAIN_AK}\nCAB_SK=${PLAIN_SK}\n\nCAB_REGION=cn-east-2\n`,
    );
    const entries = readDotDshCodearts(dir);
    expect(entries).toEqual({
      CAB_AK: PLAIN_AK,
      CAB_SK: PLAIN_SK,
      CAB_REGION: 'cn-east-2',
    });
  });

  it('readDotDshCodearts 无文件应返回 null', () => {
    expect(readDotDshCodearts(os.tmpdir())).toBeNull();
  });

  it('loadFileEnv 应合入 env（已有环境变量优先不覆盖）', () => {
    saveEnv(['CAB_AK', 'CAB_SK', 'CAB_REGION']);
    process.env.CAB_AK = 'ENV_AK_VALUE'; // 环境变量已存在
    const dir = writeDotDshCodearts(
      `CAB_AK=${PLAIN_AK}\nCAB_SK=${PLAIN_SK}\nCAB_REGION=cn-east-2\n`,
    );
    loadFileEnv(dir);
    // CAB_AK 已存在 → 不被覆盖；其余合入
    expect(process.env.CAB_AK).toBe('ENV_AK_VALUE');
    expect(process.env.CAB_SK).toBe(PLAIN_SK);
    expect(process.env.CAB_REGION).toBe('cn-east-2');
  });

  it('createCredentialProvider 显式 file 源应加载文件并经 env 读取凭据', async () => {
    saveEnv(['CAB_AK', 'CAB_SK', 'CAB_REGION']);
    delete process.env.CAB_AK;
    delete process.env.CAB_SK;
    delete process.env.CAB_REGION;
    const dir = writeDotDshCodearts(`CAB_AK=${PLAIN_AK}\nCAB_SK=${PLAIN_SK}\nCAB_REGION=cn-east-2\n`);
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const p = createCredentialProvider('file');
      expect(p).toBeInstanceOf(EnvCredentialProvider);
      const creds = await p.getCredentials();
      expect(creds).toEqual({ ak: PLAIN_AK, sk: PLAIN_SK });
      expect(p.getRegion()).toBe('cn-east-2');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('缺省且无 CAB_AK + cwd 有 .dsh-codearts 应默认 file 源', async () => {
    saveEnv(['CAB_AK']);
    delete process.env.CAB_AK;
    const dir = writeDotDshCodearts(`CAB_AK=${PLAIN_AK}\nCAB_SK=${PLAIN_SK}\n`);
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(hasDotDshCodearts()).toBe(true);
      const p = createCredentialProvider();
      expect(p).toBeInstanceOf(EnvCredentialProvider);
      const creds = await p.getCredentials();
      expect(creds).toEqual({ ak: PLAIN_AK, sk: PLAIN_SK });
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('缺省且无 CAB_AK + cwd 无 .dsh-codearts 应抛 E_CONFIG', () => {
    saveEnv(['CAB_AK']);
    delete process.env.CAB_AK;
    // 临时空目录（无 .dsh-codearts）→ 无可用凭据源 → E_CONFIG
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-provider-nofile2-'));
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(() => createCredentialProvider()).toThrow(ToolException);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
