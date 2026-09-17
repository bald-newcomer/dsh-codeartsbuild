# CodeArtsBuild Skill（dsh 插件）

> 华为云 **CodeArts Build 构建生命周期管理** 的 dsh 插件形态 Skill：本地编译构建 → 云端任务编排 → 执行控制 → 状态监控 → 产物获取 → 失败诊断。

## 特性

- **16 个原子工具**，覆盖完整构建生命周期（本地构建 / 项目感知 / 任务编排 / 执行控制 / 状态监控 / 产物与日志）
- **本地构建**（`repo_build`）：探测 → 编译指导 → 执行 → 产物 → 留档 单工具内置，编译过程由模型自决
- **云侧能力**：底层经 KooCLI（`hcloud`）承载（例外：`list_artifacts` 的 `ShowNewOutput` 需手动 HTTP 调用）
- **强制规约**：核心主键（project_id / job_id / build_no / record_id）数据来源映射，杜绝参数来源错误

## 快速开始

1. **安装 KooCLI** 并配置 AK/SK：

   ```bash
   hcloud configure set --cli-access-key=<AK> --cli-secret-key=<SK> --cli-region=cn-north-4
   ```

2. **装配插件**（dsh）：

   ```yaml
   # cordis.patch.yml / profile
   plugins:
     - id: codeartsbuild
       name: '@dsh-codearts/codeartsbuild'
       config:
         region: cn-north-4
         # projectId 由用户手动填写（当前版本）
   ```

3. **使用**：向 AI 描述意图（如"基于当前项目构建并交付"），由模型按 SKILL 规约编排工具。

## 目录结构

```
dsh-codeartsbuild/
├── README.md                        # 项目入口（本文档）
├── AGENTS.md                        # 代理工作指南（工程上下文/工作规约/待办）
├── skills/
│   └── codeartsbuild/
│       └── SKILL.md                 # Skill 定义（工具清单、强制规约、建议操作路径）
├── docs/                            # 设计文档（架构/契约/流程等）
├── src/                             # 插件实现
├── package.json
└── tsconfig.json
```

## 文档索引

| 文档 | 路径 | 状态 | 说明 |
|------|------|------|------|
| 架构设计 | `docs/architecture.md` | ✅ v0.6 | 业务抽象、dsh 形态、src 分包、KooCLI 实测、v1/v4 优先 |
| 工具接口契约 | `docs/api-contract.md` | ✅ v0.4.3 | 16 原子工具、参数/返回/错误码、工作流编排、禁用 v3 旧版接口 |
| 认证与凭据管理 | `docs/auth.md` | ✅ v0.1 | KooCLI 安装配置、AK/SK 管理、Token 自动处理 |
| 代码仓构建流程 | `docs/repo-analyzer.md` | ✅ v0.2.1 | 单一 `repo_build`、异常升级、留档 |
| 日志清洗器规范 | `docs/log-cleaner.md` | ✅ v0.2 | 基于真实日志重设计：job_key/资源池/步骤/错误码 |
| KooCLI 操作列表 | `docs/koocli-codeartsbuild-ops.txt` | ✅ 已实测 | v7.2.12 完整操作列表（约 130 个操作） |
| Skill 定义 | `skills/codeartsbuild/SKILL.md` | ✅ v0.4.3 | 工具清单、强制规约（数据来源映射）、建议操作路径 |

## 参考

- Skill 定义：[`skills/codeartsbuild/SKILL.md`](skills/codeartsbuild/SKILL.md)
- 工具契约：[`docs/api-contract.md`](docs/api-contract.md)
- [CodeArts Build API 参考](https://support.huaweicloud.com/api-codeci/cloudbuild_03_0000.html)
