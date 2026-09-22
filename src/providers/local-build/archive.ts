/**
 * 本地构建 — 过程留档
 * 对齐 repo-analyzer.md §6（每次构建必须留档）
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LocalArtifact } from './artifact.js';

/** 留档记录结构（repo-analyzer.md §6.2） */
export interface BuildArchiveRecord {
  record_id: string;
  status: string;
  repo_path: string;
  repo_name: string;
  build_target: string | null;
  timestamp: string;
  build_command: string | null;
  build_tool: string | null;
  duration_seconds: number;
  artifacts: Array<{ name: string; path: string; type: string; size_bytes: number }>;
  output_tail: string;
}

/**
 * 写入构建留档
 * @param repoPath 仓库路径
 * @param record 留档内容
 * @returns 留档文件绝对路径
 */
export function archiveBuild(repoPath: string, record: BuildArchiveRecord): string {
  const archiveDir = path.join(repoPath, '.codeartsbuild', 'build-records');
  fs.mkdirSync(archiveDir, { recursive: true });
  const filePath = path.join(archiveDir, `${record.record_id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  return filePath;
}
