# 文档索引

> 按软件工程流程分层的文档体系。项目入口见根目录 `README.md`（安装/使用）。
>
> **版本策略**：各文档版本号标注于文档头（迭代由用户决定，日常编辑不自动升版、不自动加 changelog 条目）。版本演进历史见 `changelog.md`。

## 目录结构

```
docs/
├── README.md                # 本索引
├── prd.md                   # 需求说明
├── changelog.md             # 变更记录（唯一版本源，迭代由用户决定）
├── architecture/            # 架构设计层 —— 总体架构
├── design/                  # 概要/详细设计层 —— 关键流程详细设计
├── api/                     # 接口契约层 —— 工具契约、KooCLI 归档
├── operations/              # 运维/用户文档层 —— 使用/错误/认证/产物/风险
└── example/                 # 真实样本（不入库）
```

## 文档清单

### 根目录（docs/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [prd.md](prd.md) | ✅ | 需求说明：用户故事、功能范围、非功能需求 |
| [changelog.md](changelog.md) | ✅ | 变更记录：版本演进汇总（唯一版本源，迭代由用户决定） |

### 架构设计层（architecture/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [architecture.md](architecture/architecture.md) | ✅ | 总体架构：业务抽象、dsh 形态、双 Provider、修复闭环、openapi 对齐、KooCLI 实调用确认、v3/v4 禁用、自建 HTTP 承载（AK/SK 签名） |

### 概要/详细设计层（design/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [repo-analyzer.md](design/repo-analyzer.md) | ✅ | 代码仓构建流程（单一 repo_build、异常升级、留档、module_id 全限定名、命令语义注释） |
| [log-cleaner.md](design/log-cleaner.md) | ✅ | 日志清洗器（基于真实日志重设计、ZIP 解压规约） |
| [tool-details.md](design/tool-details.md) | ✅ | 16 工具详细设计（简单接口从简，create_job 详尽：stepsPlan 组装器 + openapi 对齐 + 实调用确认 + get_status 落定） |
| [step-templates.md](design/step-templates.md) | ✅ | Step 模板库（推荐组合 + step 默认值 + 36 插件权威清单（16 不维护已过滤）+ 模板引擎：step 索引/step 模板/config 模板已落地、语言→组合映射、stepsPlan 意图输入、验证与更新策略） |
| [template-validation-suite.md](design/template-validation-suite.md) | ✅ | 模板验证测试套件方案（待办 #15）：17 组合 + 7 边界 = 24 用例、分层执行（组装器单测 → 实调用）、断言 16 条、失败 3 轮修正闭环、与 #16 联动 |
| [http-migration-plan.md](design/http-migration-plan.md) | ✅ | 自建 HTTP 承载切换方案（SDK → HTTP + AK/SK 签名）：认证设计、region→endpoint 映射、HTTP 客户端封装、v1 URL 白名单、实施步骤、回滚条件 |

### 接口契约层（api/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [api-contract.md](api/api-contract.md) | ✅ | 16 原子工具契约、工作流编排、禁用 v3/v4 旧版接口（仅 v1）、openapi 对齐、KooCLI 实调用确认、模板化组装入参（stepsPlan） |

### 运维/用户文档层（operations/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [usage.md](operations/usage.md) | ✅ | 使用指南：安装、配置、典型流程 |
| [errors.md](operations/errors.md) | ✅ | 错误码与故障排查 |
| [auth.md](operations/auth.md) | ✅ | AK/SK 签名认证与凭据管理（凭据注入抽象：env / hcloud config） |
| [artifacts.md](operations/artifacts.md) | ✅ | 构建产物规范 |
| [risk-compliance.md](operations/risk-compliance.md) | ✅ | 风险与合规 |

## 文档间依赖

```
prd.md
    → architecture/architecture.md（需求→架构）
    → design/repo-analyzer.md、design/log-cleaner.md、design/tool-details.md、design/step-templates.md、design/template-validation-suite.md（架构→详细设计）
    → api/api-contract.md（架构+详细设计→契约）
    → operations/*.md（契约→用户文档）
    → changelog.md（贯穿）
```

## 编写原则

1. **文档先行**：所有实现以 `architecture/architecture.md` 为准。
2. **契约驱动**：`api/api-contract.md` 是工具唯一事实来源。
3. **实测对齐**：华为云操作以接口实测为准（KooCLI 实调用 2026-09-16/18 + 自建 HTTP 实调用 2026-09-20），未实测标注"待确认"。
4. **版本迭代由用户决定**：日常编辑不自动升版/加 changelog 条目；版本迭代为项目级决策，由用户显式触发。
