/**
 * 凭据注入抽象 — 保留"插件不接触凭据明文"承诺
 * 对齐 architecture.md §9.1 + FE-06-自建HTTP承载切换方案-20260920.md §2.2
 *
 * 凭据源由 cordis.yml config.credentialSource 选择：
 *  - env：环境变量 CAB_AK / CAB_SK / CAB_REGION
 *  - file（2026-09-28）：从工作目录 .dsh-codearts 文件读取（key=value 行），
 *    内容合入 process.env（已有环境变量优先，不覆盖）——适用于"不想污染全局环境"的场景
 *
 * 默认探测链（未显式指定 credentialSource 时，2026-09-28）：
 *   1. 有 CAB_AK 环境变量 → env
 *   2. 当前工作目录存在 .dsh-codearts → file
 *   3. 否则 → 报 E_CONFIG，提示配置 env 或 file（hcloud-config 已于 2026-09-30 移除）
 *
 * 安全承诺：插件代码不直接读取 ak/sk 字段；AK/SK 仅在调用 AKSKSigner.sign() 签名瞬间
 * 传入（进程内存），不落盘、不入日志。.dsh-codearts 为明文文件，须加入 .gitignore 并注意权限。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ToolException } from '../core/types.js';

/** 工作目录凭据文件（key=value 行格式，明文） */
export const DOT_DSH_CODEARTS = '.dsh-codearts';

/** 凭据提供者接口 */
export interface CredentialProvider {
  /** 获取 AK/SK（进程内签名使用，不落盘） */
  getCredentials(): Promise<{ ak: string; sk: string }>;
  /** 获取 region（决定 endpoint） */
  getRegion(): string;
}

/** 凭据源类型 */
export type CredentialSource = 'env' | 'file';

/**
 * 解析 .dsh-codearts 文件（key=value 行，忽略空行与 # 注释）
 * @param cwd 查找目录（默认 process.cwd()）
 * @returns 解析出的键值对；文件不存在返回 null
 */
export function readDotDshCodearts(cwd?: string): Record<string, string> | null {
  const filePath = path.join(cwd ?? process.cwd(), DOT_DSH_CODEARTS);
  if (!fs.existsSync(filePath)) return null;
  const result: Record<string, string> = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue; // 无 = 或 key 为空 → 忽略
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/**
 * 将 .dsh-codearts 内容合入 process.env（已有环境变量优先，不覆盖）。
 * 结果缓存（重复调用不重读文件）。
 */
let fileEnvLoaded = false;
export function loadFileEnv(cwd?: string): void {
  if (fileEnvLoaded) return;
  fileEnvLoaded = true;
  const entries = readDotDshCodearts(cwd);
  if (!entries) return;
  for (const [key, value] of Object.entries(entries)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** 重置 file 源缓存（测试用） */
export function resetFileEnvCache(): void {
  fileEnvLoaded = false;
}

/** 检测当前工作目录是否存在 .dsh-codearts */
export function hasDotDshCodearts(cwd?: string): boolean {
  return fs.existsSync(path.join(cwd ?? process.cwd(), DOT_DSH_CODEARTS));
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
        '请设置 CAB_AK=<AK> CAB_SK=<SK> CAB_REGION=<region>（credentialSource=env），或在工作目录 .dsh-codearts 配置（credentialSource=file）',
      );
    }
    return { ak, sk };
  }

  getRegion(): string {
    return process.env.CAB_REGION ?? 'cn-north-4';
  }
}

/** 凭据提供者工厂（按 credentialSource 选择实现；缺省自动探测） */
export function createCredentialProvider(source?: CredentialSource): CredentialProvider {
  // 默认探测链（2026-09-28）：CAB_AK 环境变量 → env；cwd 有 .dsh-codearts → file；否则报 E_CONFIG
  const s = source ?? (process.env.CAB_AK ? 'env' : hasDotDshCodearts() ? 'file' : undefined);
  if (!s) {
    throw new ToolException(
      'E_CONFIG',
      '未配置凭据来源',
      '请设置环境变量 CAB_AK/CAB_SK/CAB_REGION（credentialSource=env），或在工作目录创建 .dsh-codearts 凭据文件（credentialSource=file）',
    );
  }
  if (s !== 'env' && s !== 'file') {
    throw new ToolException('E_CONFIG', `未知 credentialSource: ${s}`, '可选: env | file');
  }
  if (s === 'env') {
    return new EnvCredentialProvider();
  }
  // s === 'file'：加载 .dsh-codearts 合入 env，凭据经 env 读取
  loadFileEnv();
  return new EnvCredentialProvider();
}
