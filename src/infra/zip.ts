/**
 * ZIP 解压辅助（get_log 专用，对齐 log-cleaner.md §9）
 *
 * DownloadBuildFullLog 实测返回 ZIP 压缩包（PK 头，内含 message.txt 主日志）。
 * 本模块识别 ZIP 并解压出主日志文本；安全：拒绝 zip-slip（../ 路径条目）。
 */
import AdmZip from 'adm-zip';
import { ToolException } from '../core/types.js';

/** ZIP 魔数（PK\x03\x04 本地文件头 / PK\x05\x06 EOCD / PK\x07\x08 数据描述符） */
function isZipHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const b = bytes;
  return (
    (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) ||
    (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x05 && b[3] === 0x06) ||
    (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x07 && b[3] === 0x08)
  );
}

/** 判断二进制是否为可读文本（排除明显二进制乱码） */
function isPlausibleText(bytes: Uint8Array): boolean {
  // 检查前 2KB：含 NUL 字节视为二进制
  const sample = bytes.slice(0, 2048);
  for (const byte of sample) {
    if (byte === 0) return false;
  }
  return true;
}

export interface ZipExtractResult {
  /** 是否为 ZIP 输入 */
  isZip: boolean;
  /** 主日志文本（ZIP 解压后取 message.txt；非 ZIP 文本原样返回） */
  text: string;
}

/**
 * 解压构建日志响应体 → 主日志文本
 * @throws E_LOG ZIP 解压失败 / 非 ZIP 且非文本
 */
export function extractLogText(bytes: Uint8Array): ZipExtractResult {
  if (!isZipHeader(bytes)) {
    // 非 ZIP：若是可读文本则直接使用（服务端可能直接返回纯文本）
    if (isPlausibleText(bytes)) {
      return { isZip: false, text: new TextDecoder('utf-8').decode(bytes) };
    }
    throw new ToolException('E_LOG', '日志响应非 ZIP 且非文本', '请到控制台查看全文（构建详情 → 日志）');
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(Buffer.from(bytes));
  } catch (e) {
    throw new ToolException('E_LOG', `ZIP 解压失败: ${(e as Error).message}`, '请到控制台查看全文');
  }

  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new ToolException('E_LOG', 'ZIP 内无文件条目', '请到控制台查看全文');
  }

  // 安全校验：拒绝 zip-slip（../ 或绝对路径）
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (name.includes('..')) {
      throw new ToolException('E_LOG', `ZIP 条目含非法路径（拒绝解压）: ${entry.entryName}`, '日志内容异常，请到控制台查看全文');
    }
  }

  // 优先取 message.txt；无则取体积最大的 .txt/.log 条目
  const target =
    entries.find((e) => e.entryName.replace(/\\/g, '/').endsWith('message.txt')) ??
    entries
      .filter((e) => /\.(txt|log)$/i.test(e.entryName))
      .sort((a, b) => (b.header.size ?? 0) - (a.header.size ?? 0))[0] ??
    entries[0];

  const text = target.getData().toString('utf-8');
  return { isZip: true, text };
}
