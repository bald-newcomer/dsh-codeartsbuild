# AGENTS.md — CodeArtsBuild Skill 仓库代理指南

> 本文件面向在本仓库工作的 AI 代理/协作者：说明工程上下文、目录约定与工作规约。**代理修改本仓库前必读**。

## 工程上下文

- **语言**：TypeScript（strict + ESM）
- **运行时**：Node.js
- **形态**：dsh 插件（bundle）；云侧调用底层经 KooCLI（`hcloud`）承载（例外：`list_artifacts` 的 `ShowNewOutput` 需手动 HTTP 调用）

## 目录约定

| 路径 | 职责 |
|------|------|
| `skills/codeartsbuild/SKILL.md` | Skill 定义（工具清单/强制规约/建议操作路径），**LLM 编排依据** |
| `docs/api-contract.md` | 工具接口契约，**工具的唯一事实来源**，实现必须与之一致 |
| `docs/architecture.md` | 架构设计（v0.6） |
| `docs/repo-analyzer.md` | 本地构建流程（`repo_build` 规约） |
| `docs/log-cleaner.md` | 日志清洗规范 |
| `src/` | 插件实现；工具经 `ctx.tools.register(defineTool(...))` 注册 |
| `README.md` | 面向用户的项目入口（安装/使用/文档索引），**不含代理规约** |

## 工作规约

1. **文档先行**：所有实现以 `docs/architecture.md` 为准，代码与文档不一致视为缺陷。
2. **契约驱动**：`docs/api-contract.md` 是工具的唯一事实来源，先定契约再实现；改工具须同步更新契约。
3. **实测对齐**：华为云操作名/参数以 KooCLI 实测为准；未实测的标注"待确认"，不得臆造参数。
4. **v3 禁用**：CodeArtsBuild `/v3/...` 旧版接口一律禁用；仅用 v1/v4 推荐接口（白名单见 api-contract §1.4.3）。
5. **最小文档集**：不写空话，每个文档必须有可执行、可验证的内容。

## 核心主键（数据来源强制关系）

| 主键 | 获取方式 | 需要它的工具 |
|------|----------|--------------|
| `project_id` | 用户手动填写（TODO：项目管理/维护拓展） | `create_job` / `list_records` |
| `job_id` | `create_job` 返回；或 `list_jobs` 按名称（`search`）搜索 | `get_job` / `update_job` / `delete_job` / `run_job` / `stop_job` / `get_status` |
| `build_no` | `run_job` 生成（每次构建独立，同 job 内递增） | `stop_job` / `wait_build` / `get_record` / `list_artifacts` / `get_status` |
| `record_id` | `get_record(jobId, buildNo)`（唯一来源） | `get_log` |

依赖链：`project_id →(用户填写) create_job → job_id → run_job → build_no → get_record → record_id → get_log`

## 文档间关系

```mermaid
graph LR
    PRD[需求说明] --> ARCH[1. 架构设计]
    ARCH --> CONTRACT[2. 接口契约]
    ARCH --> AUTH[3. 认证说明]
    ARCH --> REPO[代码仓构建流程]
    ARCH --> LOG[日志清洗器]
    CONTRACT --> USAGE[使用指南]
    CONTRACT --> SKILL[Skill 定义]
    AUTH --> USAGE
    REPO --> USAGE
    LOG --> ERR[错误码排查]
    USAGE --> ERR
    ARCH --> RISK[风险合规]
    ARCH --> ART[产物规范]
```

## 待办事项

| # | 事项 | 状态 |
|---|------|------|
| 1 | 接口契约待人工确认项：record_id 对应关系、ShowNewOutput 字段、ExecuteJob 分支约定、get_status 替换接口 | ⏳ 待确认 |
| 2 | 按序编写：`usage.md` → `errors.md` → `prd.md` → `artifacts.md` → `risk-compliance.md` → `changelog.md` | ⏳ 待办 |
| 3 | projectId 项目管理/维护（自动选择、缓存、权限校验） | ⏳ 待办 |
| 4 | ~~架构缺口：wait_build 轮询参数~~（契约 §2.14 + 架构 §4.5 WaitOpts 已补齐：指数退避/超时 TIMEOUT 非异常/网络重试） | ✅ 完成 |
| 5 | ~~架构缺口：repo_build→create_job 映射~~（契约 §2.16 recommended_steps 同构 + repo_type→module_id 映射已补齐） | ✅ 完成 |
| 6 | ~~架构缺口：G2 修复闭环~~（架构 §6.3 已建模：3 轮上限、本地/云端双路径、超限升级） | ✅ 完成 |
| 7 | ~~架构缺口：projectId 会话级传递~~（架构 §4.3 已设计：会话上下文缓存、优先级 显式>会话>配置>询问） | ✅ 完成 |
| 8 | 架构缺口：`get_status` 替换接口 —— 架构 §4.8 已加"待定"标注（与契约 §8 #7 对齐）；**替换决策待人工确认**（候选 `ShowRunningStatus`/`ShowJobBuildRecordDetail`），确认后同步更新 | ⏳ 待人工决策 |
| 9 | ~~架构缺口：local-build 分包定位~~（评审结论：repo_build 为场景 B 核心能力，已上移至 `providers/local-build/`，与云侧 Provider 对等） | ✅ 完成 |
| 10 | **架构缺口（P3，M2+）**：list_* 缓存策略、多会话并发隔离（run_job/wait_build/stop_job）、契约一致性测试（实现 vs api-contract）、KooCLI 版本兼容、配置优先级（env vs cordis config） | ⏳ 待办 |
