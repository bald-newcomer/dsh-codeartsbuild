/**
 * 本地构建 — 编译指导
 * 对齐 FE-01-本地代码仓构建流程设计-20260919.md §4.3（参考命令表，仅指导不硬编码）
 */
import type { ProbeResult } from './probe.js';

/** 仓库类型 → 参考编译命令（本地语义：面向本机环境，可含测试选项） */
const GUIDANCE_COMMANDS: Record<string, { command: string; note: string }> = {
  maven: { command: 'mvn package -DskipTests', note: 'Maven 项目：产物默认输出于 target/ 目录' },
  gradle: { command: 'gradle build -x test', note: 'Gradle 项目：产物默认输出于 build/libs/ 目录' },
  npm: { command: 'npm run build', note: 'npm 项目：产物目录由 package.json scripts.build 决定（常见 dist/）' },
  go: { command: 'go build ./...', note: 'Go 项目：可执行文件输出于当前目录或 -o 指定' },
  python: { command: 'pip install -r requirements.txt && python -m build', note: 'Python 项目：产物为 dist/*.whl / *.tar.gz' },
  php: { command: 'composer install --no-dev && composer build', note: 'PHP 项目：依赖安装 + 构建（如有 composer scripts）' },
  cmake: { command: 'cmake -S . -B build && cmake --build build', note: 'CMake 项目：产物输出于 build/ 目录' },
  msbuild: { command: 'msbuild /p:Configuration=Release', note: 'MSBuild 项目：产物输出于 bin/Release/ 目录' },
  docker: { command: 'docker build -t {image}:{tag} .', note: 'Docker 项目：参考命令，需指定镜像名与标签' },
};

/** 生成编译指导文本 */
export function buildGuidance(probe: ProbeResult, buildCommandHint?: string): string {
  if (buildCommandHint) {
    return `已指定编译命令 \`${buildCommandHint}\`，直接执行；产物由命令决定。`;
  }
  if (probe.repoType && GUIDANCE_COMMANDS[probe.repoType]) {
    const g = GUIDANCE_COMMANDS[probe.repoType];
    return `${g.note} 参考命令 \`${g.command}\``;
  }
  return '未能识别仓库类型，无法给出参考命令——请传入 buildCommandHint 指定编译命令。';
}

/** 仓库类型 → 云端 recommended_steps 默认映射（FE-03-工具详细设计-20260918.md §3.3，全限定名白名单）
 * 环境锚点原则（FE-07 §2.1 O1）：npm 覆盖 TS/JS/Node——TypeScript 项目经 probe 命中 npm（package.json），
 * 一律归 npm 模板 20014（构建环境等价），不以"用 tsc 编译"改选 Shell；命令差异用 properties.command 覆盖 */
const REPO_TYPE_MODULE: Record<string, { module_id: string; name: string }> = {
  maven: { module_id: 'devcloud2018.codeci_action_20043.action', name: 'Maven 构建' },
  gradle: { module_id: 'devcloud2018.codeci_action_20008.action', name: 'Gradle' },
  npm: { module_id: 'devcloud2018.codeci_action_20014.action', name: 'Npm构建' },
  go: { module_id: 'devcloud2018.codeci_action_20026.action', name: 'Go语言构建' },
  python: { module_id: 'devcloud2018.codeci_action_20015.action', name: 'PyInstaller构建' },
  php: { module_id: 'devcloud2018.codeci_action_20037.action', name: 'PHP构建' },
  cmake: { module_id: 'devcloud2018.codeci_action_20005.action', name: 'CMake构建' },
  msbuild: { module_id: 'devcloud2018.codeci_action_20022.action', name: '上传软件包到软件发布库(Windows环境)' },
  docker: { module_id: 'devcloud2018.codeci_action_20035.action', name: '执行Docker命令' },
};

/** 语言 → 通用附加 step（上传软件包，多数语言标准尾步） */
const UPLOAD_STEP = { module_id: 'devcloud2018.codeci_action_20018.action', name: '上传软件包到软件发布库' };

/**
 * 生成 recommended_steps（与 create_job.steps 同构，module_id 全限定名）
 * @param buildCommand 实际执行的编译命令
 */
export function recommendedSteps(
  probe: ProbeResult,
  buildCommand: string,
): Array<{ module_id: string; name: string; command?: string }> {
  const mapping = probe.repoType ? REPO_TYPE_MODULE[probe.repoType] : undefined;
  if (!mapping) return [];
  const steps: Array<{ module_id: string; name: string; command?: string }> = [
    { module_id: mapping.module_id, name: mapping.name, command: buildCommand },
  ];
  // 容器/通用类型尾步不同；其余追加"上传软件包"
  if (probe.repoType !== 'docker' && probe.repoType !== 'msbuild') {
    steps.push(UPLOAD_STEP);
  }
  return steps;
}
