# CodeArtsBuild 插件 — 使用指南

> **文档编号**: CAB-USAGE-001  
> **版本**: v0.1.0（草案）  
> **日期**: 2026-09-17  
> **状态**: 待评审  
> **前置依赖**: 架构设计 v0.7.4（`docs/architecture/architecture.md`）、接口契约 v0.4.5（`docs/api/api-contract.md`）

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-17 | 初始使用指南 |

---

## 1. 安装与配置

### 1.1 前置依赖

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 20+（dsh 要求 22.19+） | dsh 运行环境 |
| dsh | 0.1.1+ | DeepSeek Harness |
| KooCLI（hcloud） | v7.2.12（实测） | 华为云 API 承载，AK/SK 管理 |

### 1.2 安装 KooCLI 并配置凭据

```bash
# 安装 KooCLI（详见 docs/operations/auth.md）
# 配置 AK/SK 与区域（一次性）
hcloud configure set --cli-access-key=<AK> --cli-secret-key=<SK> --cli-region=cn-north-4

# 验证
hcloud CodeArtsBuild ShowRelatedProject --cli-region=cn-north-4
```

> AK/SK 由 KooCLI 托管，插件不接触凭据。

### 1.3 装配插件（dsh）

```yaml
# cordis.patch.yml / profile
plugins:
  - id: codeartsbuild
    name: '@dsh-codearts/codeartsbuild'
    config:
      region: cn-north-4
      # projectId 不在此固定——会话级动态注入（见 §2.3）
```

```bash
dsh plugin --profile <name> add @dsh-codearts/codeartsbuild
dsh web   # 启动
```

---

## 2. 基本使用

### 2.1 会话开始

向 AI 描述意图即可，模型按 SKILL 规约（`skills/codeartsbuild/SKILL.md`）自动编排工具：

- "帮我基于当前项目构建并交付"
- "这个仓库能编译吗？产物是什么"
- "构建失败了，帮我看看原因"

### 2.2 核心主键约定

| 主键 | 获取方式 | 用于 |
|------|----------|------|
| `projectId` | 用户指定 / `list_projects` 选择（会话级缓存，一次填写复用） | `create_job` / `list_records` |
| `jobId` | `create_job` 返回 或 `list_jobs` 搜索 | `get_job` / `run_job` / `stop_job` 等 |
| `buildNo` | `run_job` 生成（同 job 内递增） | `wait_build` / `get_record` / `list_artifacts` |
| `recordId` | `get_record`（唯一来源） | `get_log` |

### 2.3 projectId 会话级传递

- 会话中首次指定 projectId（显式传入或经 `list_projects` 选择）后自动缓存
- 后续 `create_job` / `list_records` 缺省 projectId 时自动复用会话缓存
- 显式传参覆盖并刷新缓存；切换项目只需重新指定

---

## 3. 典型流程示例

### 3.1 从零到完成（本地构建 → 云端任务 → 产物）

**用户**：帮我基于当前项目构建并交付

**模型编排**（工作流一，见契约 §6.2）：

```
1. repo_build(repoPath=./)          → 本地编译成功，产物 + recommended_steps
2. list_projects                    → 选择 projectId（或用户直接提供）
3. create_job(projectId, jobName, arch, steps=recommended_steps)
                                    → 云端任务创建成功，返回 job_id
4. run_job(jobId)                   → 触发构建，返回 build_no
5. wait_build(jobId, buildNo)       → 轮询至终态 SUCCESS
6. list_artifacts(jobId, buildNo)   → 产物清单（下载 + 页面双链接）
```

**输出**：编译命令、产物信息、云端构建状态、下载/页面链接。

### 3.2 仅本地构建（验证能否编译）

**用户**：这个仓库能编译吗？产物是什么

```
repo_build(repoPath=./)
→ 输出 build_command + artifacts + recommended_steps + 留档路径
```

### 3.3 云端已有任务重跑（指定分支）

**用户**：用 develop 分支重跑任务 xxx

```
get_job(jobId)                              → 确认任务配置
run_job(jobId, parameters=[{codeBranch, develop}])
wait_build(jobId, buildNo)
list_artifacts(jobId, buildNo)
```

### 3.4 构建失败诊断与修复闭环

**用户**：构建失败了，帮我看看原因

```
wait_build(FAILED)                          → 定位失败
get_record(jobId, buildNo)                  → 取 record_id
get_log(recordId)                           → 拉取并清洗日志
→ LLM 分析根因（error_type/error_code）     → 给出修复建议
→ 修复闭环（≤3 轮）：repo_build 重跑 或 update_job+run_job 重跑
→ 无果升级用户（附各轮尝试记录）
```

---

## 4. 配置项

| 配置 | 位置 | 说明 |
|------|------|------|
| region | 插件 config / `CODEARTS_BUILD_REGION` | 透传 hcloud `--cli-region` |
| projectId | 会话级（不固定配置） | `CODEARTS_BUILD_PROJECT_ID` 仅作可选默认 |
| consoleBaseUrl | `CODEARTS_CONSOLE_BASE_URL` | 拼装产物页面查询链接 |
| 轮询参数 | `wait_build` 入参 | intervalMs(默认10s)/timeoutMs(默认30min)/maxBackoffMs(默认30s) |

---

## 5. 常见问题

| 问题 | 处理 |
|------|------|
| hcloud 未安装 | 见 docs/operations/auth.md §2 安装指引 |
| 认证失败 | 检查 `hcloud configure show`；KooCLI 自动处理 Token |
| 找不到项目/任务 | `list_projects` / `list_jobs` 确认 ID；检查 region 是否正确 |
| 构建失败 | 走 G2 诊断流程（get_log → 分析 → 修复闭环） |
| 产物为空 | 检查构建步骤是否产出到标准目录；确认 buildNo 对应成功构建 |
