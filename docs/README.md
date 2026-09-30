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
├── architecture/            # 架构设计层 —— 总体架构（概要设计）
├── design/                  # 特性设计层 —— FE-编号-{特性内容}-日期（独立迭代特性/详细设计）
├── test/                    # 测试设计层 —— TEST-编号-{测试设计内容}-日期
├── api/                     # 接口契约层 —— 工具契约、KooCLI 参考资料
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
| [architecture.md](architecture/architecture.md) | ✅ | 总体架构（概要设计）：业务抽象、dsh 形态、双 Provider、修复闭环、v3/v4 禁用、自建 HTTP 承载（AK/SK 签名）；详细设计见 design/FE-* |

### 特性设计层（design/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [FE-01-本地代码仓构建流程设计-20260919.md](design/FE-01-本地代码仓构建流程设计-20260919.md) | ✅ | 代码仓构建流程（单一 repo_build、异常升级、留档、module_id 全限定名） |
| [FE-02-日志清洗器规范-20260918.md](design/FE-02-日志清洗器规范-20260918.md) | ✅ | 日志清洗器（基于真实日志重设计、ZIP 解压规约） |
| [FE-03-工具详细设计-20260918.md](design/FE-03-工具详细设计-20260918.md) | ✅ | 16 工具详细设计（create_job 详尽：stepsPlan 组装器 + openapi 对齐 + get_status 落定） |
| [FE-04-Step模板库拆解-20260918.md](design/FE-04-Step模板库拆解-20260918.md) | ✅ | Step 模板库（推荐组合 + step 默认值 + 插件权威清单 + 模板引擎） |
| [FE-05-华为云调用承载方案对比评审决策-20260920.md](design/FE-05-华为云调用承载方案对比评审决策-20260920.md) | ✅ | 独立迭代特性：SDK → 自建 HTTP 承载方案对比评审决策 |
| [FE-06-自建HTTP承载切换方案-20260920.md](design/FE-06-自建HTTP承载切换方案-20260920.md) | ✅ | 自建 HTTP 承载切换实施计划（认证设计、HTTP 客户端封装、实施步骤、回滚条件） |
| [FE-07-构建任务创建工作流优化-20260922.md](design/FE-07-构建任务创建工作流优化-20260922.md) | ✅ | 构建任务创建工作流优化（基于人工测试失败复盘：模板环境锚点、scm 字段来源强制、本地/远端仓库流程） |
| [FE-08-本地远端仓库方案探索-20260923.md](design/FE-08-本地远端仓库方案探索-20260923.md) | ✅ | CodeArtsRepo 仓库方案探索（接口实测清单、本地推送链路、repo_prepare 形态决策，§7 2026-09-28 调整） |
| [FE-09-S1实测scm编排缺陷分析与解决评估-20260928.md](design/FE-09-S1实测scm编排缺陷分析与解决评估-20260928.md) | ✅ | S1 真实会话轨迹暴露的 scm 编排缺陷分析（repo_prepare 已有远端缺 repo_id / create_job 硬试超限 / agencyUrn 绕过）+ 5 方案评估 |

### 测试设计层（test/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [TEST-01-模板验证测试套件设计-20260918.md](test/TEST-01-模板验证测试套件设计-20260918.md) | ✅ | 模板验证测试套件方案（待办 #15）：17 组合 + 7 边界 = 24 用例、分层执行 |
| [TEST-02-Layer2全工具实调测试设计-20260921.md](test/TEST-02-Layer2全工具实调测试设计-20260921.md) | ✅ | Layer 2 全工具实调测试（22/22 通过，契约一致性验证） |
| [TEST-03-用户故事集成测试设计-20260921.md](test/TEST-03-用户故事集成测试设计-20260921.md) | ✅ | 用户故事级端到端旅程测试（8 旅程，跨工具数据流转） |
| [TEST-04-场景集成测试设计-20260922.md](test/TEST-04-场景集成测试设计-20260922.md) | ✅ | 场景级集成测试（真实 dsh 会话完整构建链路：S1~S4 场景 + 链路符合性清单 + 业界 agent 测试范式） |

### 接口契约层（api/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [api-contract.md](api/api-contract.md) | ✅ | 17 原子工具契约（唯一事实来源）、工作流编排、禁用 v3/v4 旧版接口（仅 v1）、状态枚举 |
| [tools/](api/tools/) | ✅ | 各工具契约详情（17 个文件，按工具拆分） |
| [koocli-operation-reference.md](api/koocli-operation-reference.md) | ✅ | KooCLI 操作列表参考资料（HTTP 实现接口名 ↔ URL 对照，实测归档） |

### 运维/用户文档层（operations/）

| 文档 | 状态 | 说明 |
|------|------|------|
| [usage.md](operations/usage.md) | ✅ | 使用指南：安装、配置、典型流程 |
| [errors.md](operations/errors.md) | ✅ | 错误码与故障排查 |
| [auth.md](operations/auth.md) | ✅ | AK/SK 签名认证与凭据管理（凭据注入抽象：env / hcloud config / .dsh-codearts 文件） |
| [artifacts.md](operations/artifacts.md) | ✅ | 构建产物规范 |
| [risk-compliance.md](operations/risk-compliance.md) | ✅ | 风险与合规 |
| [test-run-reference.md](operations/test-run-reference.md) | ✅ | TEST-04 测试启动与验证流程（可复现；环境/装配/凭据/踩坑；待 skill 化） |

## 文档间依赖

```
prd.md
    → architecture/architecture.md（需求→架构）
    → design/FE-01..07（架构→特性设计）
    → api/api-contract.md（架构+特性设计→契约）
    → operations/*.md（契约→用户文档）
    → test/TEST-01..04（契约+需求→测试设计）
    → changelog.md（贯穿）
```

## 编写原则

1. **文档先行**：所有实现以 `architecture/architecture.md` 为准。
2. **契约驱动**：`api/api-contract.md` 是工具唯一事实来源。
3. **实测对齐**：华为云操作以接口实测为准（KooCLI 实调用 2026-09-16/18 + 自建 HTTP 实调用 2026-09-20），未实测标注"待确认"。
4. **版本迭代由用户决定**：日常编辑不自动升版/加 changelog 条目；版本迭代为项目级决策，由用户显式触发。
5. **特性设计（FE）/测试设计（TEST）命名**：独立迭代特性与测试设计须按 `FE-编号-{特性内容}-日期` / `TEST-编号-{测试设计内容}-日期` 命名（见 AGENTS.md 规约 7/8）。
