/**
 * 凭据注入抽象 — 保留"插件不接触凭据明文"承诺
 * 对齐 architecture.md §9.1 + http-migration-plan.md §2.2
 *
 * 凭据源由 cordis.yml config.credentialSource 选择：
 *  - hcloud-config（默认）：从 ~/.hcloud/config.json 读取
 *  - env：环境变量 CAB_AK / CAB_SK / CAB_REGION
 *
 * 安全承诺：插件代码不直接读取 ak/sk 字段；AK/SK 仅在调用 AKSKSigner.sign() 签名瞬间
 * 传入（进程内存），不落盘、不入日志。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolException } from '../core/types.js';

/** 凭据提供者接口 */
export interface CredentialProvider {
  /** 获取 AK/SK（进程内签名使用，不落盘） */
  getCredentials(): Promise<{ ak: string; sk: string }>;
  /** 获取 region（决定 endpoint） */
  getRegion(): string;
}

/** 凭据源类型 */
export type CredentialSource = 'hcloud-config' | 'env';

/**
 * 从 hcloud config 读取凭据（兼容已有 hcloud configure 用户）
 * 注意：AK/SK 仅在返回后立即传给签名器，插件业务代码不接触
 */
export class HcloudConfigCredentialProvider implements CredentialProvider {
  private configPath: string;
  private cachedCredentials: { ak: string; sk: string } | null = null;
  private cachedRegion: string | null = null;

  constructor(configPath?: string) {
    this.configPath = configPath ?? path.join(os.homedir(), '.hcloud', 'config.json');
  }

  async getCredentials(): Promise<{ ak: string; sk: string }> {
    if (this.cachedCredentials) return this.cachedCredentials;

    let config: { profiles?: Array<{ name?: string; accessKeyId?: string; secretAccessKey?: string; region?: string }>; current?: string };
    try {
      if (!fs.existsSync(this.configPath)) {
        throw new ToolException(
          'E_CONFIG',
          `hcloud config 未找到: ${this.configPath}`,
          '请先执行 hcloud configure set 配置 AK/SK（见 docs/operations/auth.md §2.1），或改用 credentialSource=env',
        );
      }
      config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (e) {
      if (e instanceof ToolException) throw e;
      throw new ToolException('E_CONFIG', `hcloud config 解析失败: ${this.configPath}`, (e as Error).message);
    }

    const profile = (config.profiles ?? []).find((p) => p.name === (config.current ?? 'default')) ?? config.profiles?.[0];
    if (!profile) {
      throw new ToolException('E_CONFIG', 'hcloud config 无可用 profile', '请执行 hcloud configure set');
    }

    // hcloud config 可能为加密存储：AK/SK 是密文（AK 非 20 位字母数字明文格式），
    // 直接用密文签名必然 401。检测格式：非明文则回退环境变量，仍无则明确报错。
    const rawAk = profile.accessKeyId;
    const rawSk = profile.secretAccessKey;
    const isPlainAk = typeof rawAk === 'string' && /^[A-Z0-9]{20}$/.test(rawAk);
    const isPlainSk = typeof rawSk === 'string' && /^[A-Za-z0-9]{40}$/.test(rawSk);
    if (isPlainAk && isPlainSk) {
      this.cachedCredentials = { ak: rawAk, sk: rawSk };
      this.cachedRegion = profile.region ?? 'cn-north-4';
      return this.cachedCredentials;
    }
    // 非明文（加密存储或字段缺失）→ 回退环境变量
    const ak = process.env.CAB_AK;
    const sk = process.env.CAB_SK;
    if (!ak || !sk) {
      throw new ToolException(
        'E_CONFIG',
        'hcloud config AK/SK 为加密存储或不可读',
        '请改用环境变量 CAB_AK/CAB_SK/CAB_REGION（credentialSource=env），或执行 hcloud configure set 重新配置',
      );
    }
    this.cachedCredentials = { ak, sk };
    this.cachedRegion = process.env.CAB_REGION ?? profile.region ?? 'cn-north-4';
    return this.cachedCredentials;
  }

  getRegion(): string {
    return this.cachedRegion ?? 'cn-north-4';
  }
}

/**
 * 从环境变量注入凭据（CI 友好）
 * 环境变量：CAB_AK / CAB_SK / CAB_REGION
 */
export class EnvCredentialProvider implements CredentialProvider {
  async getCredentials(): Promise<{ ak: string; sk: string }> {
    const ak = process.env.CAB_AK;
    const sk = process.env.CAB_SK;
    if (!ak || !sk) {
      throw new ToolException(
        'E_CONFIG',
        '环境变量 CAB_AK/CAB_SK 未设置',
        '请设置 CAB_AK=<AK> CAB_SK=<SK> CAB_REGION=<region>，或改用 credentialSource=hcloud-config',
      );
    }
    return { ak, sk };
  }

  getRegion(): string {
    return process.env.CAB_REGION ?? 'cn-north-4';
  }
}

/** 凭据提供者工厂（按 credentialSource 选择实现） */
export function createCredentialProvider(source?: CredentialSource): CredentialProvider {
  const s = source ?? (process.env.CAB_AK ? 'env' : 'hcloud-config');
  switch (s) {
    case 'env':
      return new EnvCredentialProvider();
    case 'hcloud-config':
      return new HcloudConfigCredentialProvider();
    default:
      throw new ToolException('E_CONFIG', `未知 credentialSource: ${s}`, '可选: hcloud-config | env');
  }
}
