# 文档索引（六层软件工程体系）

> 按软件工程流程分层的文档体系。项目入口见根目录 `README.md`（安装/使用）。

## 目录结构

```
docs/
├── requirements/        # 需求层 —— 需求说明
├── architecture/        # 架构设计层 —— 总体架构
├── design/              # 概要/详细设计层 —— 关键流程详细设计
├── api/                 # 接口契约层 —— 工具契约、KooCLI 归档
├── operations/          # 运维/用户文档层 —— 使用/错误/认证/产物/风险
├── management/          # 项目管理层 —— 变更记录、本索引
└── example/             # 真实样本（不入库）
```

## 文档清单

### 需求层（requirements/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [prd.md](requirements/prd.md) | ✅ v0.1 | 需求说明：用户故事、功能范围、非功能需求 |

### 架构设计层（architecture/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [architecture.md](architecture/architecture.md) | ✅ v0.7.4 | 总体架构：业务抽象、dsh 形态、双 Provider、修复闭环 |

### 概要/详细设计层（design/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [repo-analyzer.md](design/repo-analyzer.md) | ✅ v0.2.2 | 代码仓构建流程（单一 repo_build、异常升级、留档） |
| [log-cleaner.md](design/log-cleaner.md) | ✅ v0.2 | 日志清洗器（基于真实日志重设计） |

### 接口契约层（api/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [api-contract.md](api/api-contract.md) | ✅ v0.4.5 | 16 原子工具契约、工作流编排、禁用 v3 旧版接口 |
| [koocli-codeartsbuild-ops.txt](api/koocli-codeartsbuild-ops.txt) | ✅ 已实测 | KooCLI v7.2.12 完整操作列表归档 |

### 运维/用户文档层（operations/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [usage.md](operations/usage.md) | ✅ v0.1 | 使用指南：安装、配置、典型流程 |
| [errors.md](operations/errors.md) | ✅ v0.1 | 错误码与故障排查 |
| [auth.md](operations/auth.md) | ✅ v0.1 | KooCLI 认证与凭据管理 |
| [artifacts.md](operations/artifacts.md) | ✅ v0.1 | 构建产物规范 |
| [risk-compliance.md](operations/risk-compliance.md) | ✅ v0.1 | 风险与合规 |

### 项目管理层（management/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [changelog.md](management/changelog.md) | ✅ v0.1 | 变更记录：版本演进汇总 |
| 本文件（README.md） | ✅ | 文档索引 |

## 文档间依赖

```
requirements/prd.md
    → architecture/architecture.md（需求→架构）
    → design/repo-analyzer.md、design/log-cleaner.md（架构→详细设计）
    → api/api-contract.md（架构+详细设计→契约）
    → operations/*.md（契约→用户文档）
    → management/changelog.md（贯穿）
```

## 编写原则

1. **文档先行**：所有实现以 `architecture/architecture.md` 为准。
2. **契约驱动**：`api/api-contract.md` 是工具唯一事实来源。
3. **实测对齐**：华为云操作以 KooCLI 实测为准，未实测标注"待确认"。
