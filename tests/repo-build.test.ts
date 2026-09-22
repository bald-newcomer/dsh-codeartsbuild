/**
 * repo_build 本地构建单测（Layer 1，mock fs + child_process，不执行真实编译）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// mock child_process.spawn：捕获命令并模拟退出码
const { spawnMock, mockSpawn } = vi.hoisted(() => {
  const spawnMock = vi.fn();
  /** 模拟 spawn 子进程结果（成功/失败） */
  function mockSpawn(exitCode: number, stdout: string, stderr: string) {
    const child = {
      stdout: { on: (ev: string, cb: (c: Buffer) => void) => ev === 'data' && cb(Buffer.from(stdout)) },
      stderr: { on: (ev: string, cb: (c: Buffer) => void) => ev === 'data' && cb(Buffer.from(stderr)) },
      on: (ev: string, cb: (arg?: unknown) => void) => {
        if (ev === 'error') return; // 不触发
        if (ev === 'close') cb(exitCode);
      },
      kill: vi.fn(),
    };
    spawnMock.mockReturnValue(child);
  }
  return { spawnMock, mockSpawn };
});

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { repoBuildHandler } from '../src/providers/local-build/build.js';
import { probeRepo } from '../src/providers/local-build/probe.js';
import { scanArtifacts } from '../src/providers/local-build/artifact.js';
import { buildGuidance, recommendedSteps } from '../src/providers/local-build/guidance.js';

/** 构造 mock 仓库（含标志文件） */
function makeRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-repo-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe('repoBuildHandler', () => {
  it('Maven 仓库探测 + 编译成功 + 产物扫描 + 留档', async () => {
    const repo = makeRepo({
      'pom.xml': '<project/>',
      'target/demo-1.0.0.jar': 'jar-bytes',
    });
    mockSpawn(0, '[INFO] BUILD SUCCESS', '');

    const result = await repoBuildHandler({ repoPath: repo, timeoutMs: 30_000 });

    expect(result.isError).toBe(false);
    const data = result.data as {
      status: string;
      repo_type: string;
      build_command: string;
      artifacts: Array<{ name: string; type: string; uri: string }>;
      recommended_steps: Array<{ module_id: string }>;
      archived: { path: string };
    };
    expect(data.status).toBe('SUCCESS');
    expect(data.repo_type).toBe('maven');
    expect(data.build_command).toBe('mvn package -DskipTests'); // 参考命令
    expect(data.artifacts).toHaveLength(1);
    expect(data.artifacts[0].name).toBe('demo-1.0.0.jar');
    expect(data.artifacts[0].type).toBe('local');
    expect(data.recommended_steps[0].module_id).toBe('devcloud2018.codeci_action_20043.action');
    // 留档已写入
    expect(fs.existsSync(path.join(repo, data.archived.path))).toBe(true);
  });

  it('编译失败返回结构化 error + FAILED', async () => {
    const repo = makeRepo({ 'pom.xml': '<project/>' });
    mockSpawn(1, '', 'Could not resolve dependencies for project demo');

    const result = await repoBuildHandler({ repoPath: repo, timeoutMs: 30_000 });

    expect(result.isError).toBe(false); // 失败不抛异常，返回结构化结果
    const data = result.data as { status: string; error: { error_type: string } };
    expect(data.status).toBe('FAILED');
    expect(data.error.error_type).toBe('DEPENDENCY_MISSING');
    expect(data.recommended_steps).toEqual([]);
  });

  it('buildCommandHint 覆盖参考命令', async () => {
    const repo = makeRepo({ 'go.mod': 'module demo' });
    mockSpawn(0, 'ok', '');

    const result = await repoBuildHandler({ repoPath: repo, buildCommandHint: 'go build -o bin/demo ./...', timeoutMs: 30_000 });
    const data = result.data as { build_command: string; repo_type: string };
    expect(data.build_command).toBe('go build -o bin/demo ./...');
    expect(data.repo_type).toBe('go');
  });

  it('repoPath 为空应抛 E_PARAM', async () => {
    const result = await repoBuildHandler({ repoPath: '' } as never);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
  });

  it('仓库路径不存在应抛异常（映射 E_API 或 E_PARAM）', async () => {
    const result = await repoBuildHandler({ repoPath: path.join(os.tmpdir(), 'no-such-dir-xyz') });
    expect(result.isError).toBe(true);
  });

  it('未知仓库类型且无 hint 应抛 E_PARAM', async () => {
    const repo = makeRepo({ 'README.md': 'nothing here' });
    const result = await repoBuildHandler({ repoPath: repo });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_PARAM');
  });
});

describe('probeRepo', () => {
  it('探测 pom.xml → maven', () => {
    const repo = makeRepo({ 'pom.xml': '<project/>' });
    expect(probeRepo(repo)).toMatchObject({ repoType: 'maven', language: 'Java', buildTool: 'Maven' });
  });

  it('探测 package.json → npm', () => {
    const repo = makeRepo({ 'package.json': '{}' });
    expect(probeRepo(repo)).toMatchObject({ repoType: 'npm', language: 'JavaScript' });
  });

  it('显式指定类型跳过探测', () => {
    const repo = makeRepo({ 'README.md': 'x' });
    expect(probeRepo(repo, 'docker')).toMatchObject({ repoType: 'docker' });
  });

  it('未知仓库返回 null', () => {
    const repo = makeRepo({ 'README.md': 'x' });
    expect(probeRepo(repo).repoType).toBeNull();
  });
});

describe('scanArtifacts', () => {
  it('扫描 target/*.jar（maven）', () => {
    const repo = makeRepo({
      'pom.xml': '<project/>',
      'target/demo.jar': 'x',
      'src/main/Foo.java': 'class Foo',
    });
    const artifacts = scanArtifacts(repo, { repoType: 'maven', language: 'Java', buildTool: 'Maven', manifest: null }, 'rec-1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].name).toBe('demo.jar');
    expect(artifacts[0].uri).toBe('target/demo.jar');
  });

  it('跳过 node_modules / 隐藏目录', () => {
    const repo = makeRepo({
      'package.json': '{}',
      'dist/app.js': 'x',
      'node_modules/lib/big.js': 'should-skip',
      '.hidden/secret.js': 'should-skip',
    });
    const artifacts = scanArtifacts(repo, { repoType: 'npm', language: 'JavaScript', buildTool: 'npm', manifest: null }, 'rec-2');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].uri).toBe('dist/app.js');
  });
});

describe('buildGuidance / recommendedSteps', () => {
  it('maven 指导 + recommended_steps 含上传软件包尾步', () => {
    const probe = { repoType: 'maven', language: 'Java', buildTool: 'Maven', manifest: 'pom.xml' };
    expect(buildGuidance(probe)).toContain('mvn package -DskipTests');
    const steps = recommendedSteps(probe, 'mvn package');
    expect(steps).toHaveLength(2);
    expect(steps[0].module_id).toBe('devcloud2018.codeci_action_20043.action');
    expect(steps[1].module_id).toBe('devcloud2018.codeci_action_20018.action'); // 上传软件包
  });

  it('docker 类型尾步为 Docker 命令（不上传软件包）', () => {
    const probe = { repoType: 'docker', language: 'Container', buildTool: 'Docker', manifest: 'Dockerfile' };
    const steps = recommendedSteps(probe, 'docker build .');
    expect(steps).toHaveLength(1);
    expect(steps[0].module_id).toBe('devcloud2018.codeci_action_20035.action');
  });

  it('未知类型无 recommended_steps', () => {
    const probe = { repoType: null, language: null, buildTool: null, manifest: null };
    expect(recommendedSteps(probe, 'make')).toEqual([]);
  });
});
