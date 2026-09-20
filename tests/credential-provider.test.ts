/**
 * credential-provider 单测（Layer 1，mock fs / env，不需网络）
 * 对齐 http-migration-plan.md §2.2 + architecture.md §9.1
 *
 * 重点覆盖 M1 修复：hcloud config 密文 AK/SK（非明文格式）检测与 env 回退。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  HcloudConfigCredentialProvider,
  EnvCredentialProvider,
  createCredentialProvider,
} from '../src/infra/credential-provider.js';
import { ToolException } from '../src/core/types.js';

/** 明文 AK/SK（华为云格式：AK 20 位大写字母数字，SK 40 位字母数字） */
const PLAIN_AK = 'ABCDEFGHIJ1234567890';
const PLAIN_SK = 'abcdefghijklmnopqrstuvwxyz0123456789abcd';
const CIPHER_AK = '+NSlZ4uQ8vXk2mP7rT9wYbN5cGd1hJf3Lq6sAe';
const CIPHER_SK = 'x9Kp2mN7vB4cZ8qW1eR6tY3uI5oP0aL9sD7fG2hJ4kM6n';

/** 在临时目录写 hcloud config fixture，返回 configPath */
function writeConfig(profile: Record<string, unknown>, extra?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-provider-test-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ profiles: [profile], current: 'default', ...extra }));
  return configPath;
}

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
});

describe('HcloudConfigCredentialProvider（M1 密文检测）', () => {
  it('明文 AK/SK（20/40 位）应直接使用', async () => {
    const configPath = writeConfig({
      name: 'default',
      accessKeyId: PLAIN_AK,
      secretAccessKey: PLAIN_SK,
      region: 'cn-north-4',
    });
    const provider = new HcloudConfigCredentialProvider(configPath);

    const creds = await provider.getCredentials();
    expect(creds).toEqual({ ak: PLAIN_AK, sk: PLAIN_SK });
    expect(provider.getRegion()).toBe('cn-north-4');
  });

  it('密文 AK（48 字符非明文格式）应回退环境变量', async () => {
    saveEnv(['CAB_AK', 'CAB_SK']);
    process.env.CAB_AK = PLAIN_AK;
    process.env.CAB_SK = PLAIN_SK;
    const configPath = writeConfig({
      name: 'default',
      accessKeyId: CIPHER_AK,
      secretAccessKey: CIPHER_SK,
      region: 'cn-north-4',
    });
    const provider = new HcloudConfigCredentialProvider(configPath);

    const creds = await provider.getCredentials();
    // 密文被识别，回退 env 的明文
    expect(creds).toEqual({ ak: PLAIN_AK, sk: PLAIN_SK });
  });

  it('密文且无环境变量应抛 E_CONFIG（明确提示）', async () => {
    saveEnv(['CAB_AK', 'CAB_SK']);
    delete process.env.CAB_AK;
    delete process.env.CAB_SK;
    const configPath = writeConfig({
      name: 'default',
      accessKeyId: CIPHER_AK,
      secretAccessKey: CIPHER_SK,
    });
    const provider = new HcloudConfigCredentialProvider(configPath);

    await expect(provider.getCredentials()).rejects.toMatchObject({
      code: 'E_CONFIG',
      message: expect.stringContaining('加密存储'),
    });
  });

  it('AK 明文但 SK 缺失应回退 env', async () => {
    saveEnv(['CAB_AK', 'CAB_SK']);
    process.env.CAB_AK = PLAIN_AK;
    process.env.CAB_SK = PLAIN_SK;
    const configPath = writeConfig({ name: 'default', accessKeyId: PLAIN_AK }); // 无 secretAccessKey
    const provider = new HcloudConfigCredentialProvider(configPath);

    const creds = await provider.getCredentials();
    expect(creds).toEqual({ ak: PLAIN_AK, sk: PLAIN_SK });
  });

  it('config 文件不存在应抛 E_CONFIG', async () => {
    const provider = new HcloudConfigCredentialProvider(path.join(os.tmpdir(), 'no-such-config.json'));
    await expect(provider.getCredentials()).rejects.toMatchObject({ code: 'E_CONFIG' });
  });

  it('config JSON 解析失败应抛 E_CONFIG', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-provider-test-'));
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, '{invalid json');
    const provider = new HcloudConfigCredentialProvider(configPath);

    await expect(provider.getCredentials()).rejects.toMatchObject({ code: 'E_CONFIG' });
  });

  it('无可用 profile 应抛 E_CONFIG', async () => {
    const configPath = writeConfig({}, { profiles: [] });
    const provider = new HcloudConfigCredentialProvider(configPath);

    await expect(provider.getCredentials()).rejects.toMatchObject({ code: 'E_CONFIG' });
  });

  it('凭据应缓存（重复调用不重读文件）', async () => {
    const configPath = writeConfig({
      name: 'default',
      accessKeyId: PLAIN_AK,
      secretAccessKey: PLAIN_SK,
    });
    const provider = new HcloudConfigCredentialProvider(configPath);

    const readSpy = vi.spyOn(fs, 'readFileSync');
    await provider.getCredentials();
    readSpy.mockClear();
    await provider.getCredentials();
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('getRegion 在 getCredentials 前应返回默认 cn-north-4', () => {
    const configPath = writeConfig({
      name: 'default',
      accessKeyId: PLAIN_AK,
      secretAccessKey: PLAIN_SK,
      region: 'cn-east-3',
    });
    const provider = new HcloudConfigCredentialProvider(configPath);
    // 未调用 getCredentials 时 region 未缓存 → 默认
    expect(provider.getRegion()).toBe('cn-north-4');
  });

  it('getRegion 在 getCredentials 后应返回 profile.region', async () => {
    const configPath = writeConfig({
      name: 'default',
      accessKeyId: PLAIN_AK,
      secretAccessKey: PLAIN_SK,
      region: 'cn-east-3',
    });
    const provider = new HcloudConfigCredentialProvider(configPath);
    await provider.getCredentials();
    expect(provider.getRegion()).toBe('cn-east-3');
  });
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

  it('显式 hcloud-config 源应返回 HcloudConfigCredentialProvider', () => {
    const p = createCredentialProvider('hcloud-config');
    expect(p).toBeInstanceOf(HcloudConfigCredentialProvider);
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

  it('缺省且无 CAB_AK 应默认 hcloud-config', () => {
    saveEnv(['CAB_AK']);
    delete process.env.CAB_AK;
    const p = createCredentialProvider();
    expect(p).toBeInstanceOf(HcloudConfigCredentialProvider);
  });
});
