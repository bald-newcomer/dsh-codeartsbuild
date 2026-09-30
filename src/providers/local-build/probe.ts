/**
 * 本地构建 — 仓库类型探测
 * 对齐 FE-01-本地代码仓构建流程设计-20260919.md §4.2（轻量探测语言/构建工具）
 */
import fs from 'node:fs';
import path from 'node:path';

/** 探测结果 */
export interface ProbeResult {
  repoType: string | null;
  language: string | null;
  buildTool: string | null;
  /** 探测到的构建工具提示（参考命令来源） */
  manifest: string | null;
}

/** 仓库类型 → 探测文件（存在任一即命中） */
const TYPE_SIGNATURES: Array<{ type: string; language: string; tool: string; files: string[] }> = [
  { type: 'maven', language: 'Java', tool: 'Maven', files: ['pom.xml'] },
  { type: 'gradle', language: 'Java', tool: 'Gradle', files: ['build.gradle', 'build.gradle.kts', 'settings.gradle'] },
  { type: 'npm', language: 'JavaScript', tool: 'npm', files: ['package.json'] },
  { type: 'go', language: 'Go', tool: 'Go', files: ['go.mod'] },
  { type: 'python', language: 'Python', tool: 'Python', files: ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile'] },
  { type: 'php', language: 'PHP', tool: 'Composer', files: ['composer.json'] },
  { type: 'cmake', language: 'C/C++', tool: 'CMake', files: ['CMakeLists.txt'] },
  { type: 'msbuild', language: 'C#', tool: 'MSBuild', files: ['*.sln', '*.csproj'] },
  { type: 'docker', language: 'Container', tool: 'Docker', files: ['Dockerfile', 'docker-compose.yml'] },
];

/**
 * 探测仓库类型（repoType 未传时自动）
 * @param repoPath 本地仓库绝对路径
 * @param repoType 显式指定类型（跳过探测）
 */
export function probeRepo(repoPath: string, repoType?: string): ProbeResult {
  if (repoType) {
    // 显式指定：按已知类型补全语言/工具
    const known = TYPE_SIGNATURES.find((t) => t.type === repoType);
    if (known) return { repoType, language: known.language, buildTool: known.tool, manifest: known.files[0] };
    return { repoType, language: null, buildTool: null, manifest: null };
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(repoPath);
  } catch (e) {
    throw new Error(`仓库路径不可读: ${repoPath}（${(e as Error).message}）`);
  }

  for (const sig of TYPE_SIGNATURES) {
    // 通配（*.sln / *.csproj）用 startsWith 匹配
    const matched = sig.files.some((f) => {
      if (f.includes('*')) {
        const ext = f.slice(1);
        return entries.some((e) => e.endsWith(ext));
      }
      return entries.includes(f);
    });
    if (matched) return { repoType: sig.type, language: sig.language, buildTool: sig.tool, manifest: sig.files[0] };
  }
  return { repoType: null, language: null, buildTool: null, manifest: null };
}
