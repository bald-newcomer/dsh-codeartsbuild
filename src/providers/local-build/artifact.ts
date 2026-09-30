/**
 * 本地构建 — 产物收集（glob 扫描）
 * 对齐 FE-01-本地代码仓构建流程设计-20260919.md §4.2 + artifacts.md §4（type: local 统一结构体）
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ProbeResult } from './probe.js';

/** 产物结构体（artifacts.md §1，type 固定 local） */
export interface LocalArtifact {
  name: string;
  type: 'local';
  language: string | null;
  record_id: string;
  size_bytes: number;
  uri: string;
}

/** 仓库类型 → 产物扫描模式（扩展名/目录） */
const ARTIFACT_PATTERNS: Record<string, Array<{ dir?: string; ext?: string }>> = {
  maven: [{ dir: 'target', ext: '.jar' }, { dir: 'target', ext: '.war' }],
  gradle: [{ dir: 'build/libs', ext: '.jar' }],
  npm: [{ dir: 'dist' }, { dir: 'build' }],
  go: [{ ext: '.exe' }],
  python: [{ dir: 'dist', ext: '.whl' }, { dir: 'dist', ext: '.tar.gz' }],
  php: [{ dir: 'dist' }],
  cmake: [{ dir: 'build' }],
  msbuild: [{ dir: 'bin', ext: '.exe' }, { dir: 'bin', ext: '.dll' }],
  docker: [{ ext: '.tar' }],
};

/**
 * 扫描仓库产物（递归遍历，匹配已知模式；未知类型时尝试常见产物目录）
 */
export function scanArtifacts(
  repoPath: string,
  probe: ProbeResult,
  recordId: string,
  maxItems = 50,
): LocalArtifact[] {
  const patterns = probe.repoType ? ARTIFACT_PATTERNS[probe.repoType] : [{ dir: 'dist' }, { dir: 'build' }, { dir: 'target' }];
  const artifacts: LocalArtifact[] = [];

  const walk = (dir: string): void => {
    if (artifacts.length >= maxItems) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (artifacts.length >= maxItems) return;
      const full = path.join(dir, entry.name);
      // 跳过隐藏目录与依赖目录
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || ['node_modules', 'vendor', '.git'].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(repoPath, full).replace(/\\/g, '/');
      const matched = patterns.some((p) => {
        if (p.dir && !rel.startsWith(p.dir.replace(/\\/g, '/'))) return false;
        if (p.ext && !entry.name.endsWith(p.ext)) return false;
        return true;
      });
      if (!matched) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        // 忽略 stat 失败
      }
      artifacts.push({
        name: entry.name,
        type: 'local',
        language: probe.language,
        record_id: recordId,
        size_bytes: size,
        uri: rel,
      });
    }
  };

  walk(repoPath);
  return artifacts;
}
