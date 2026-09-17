---
name: codeartsbuild
description: >
  Huawei Cloud CodeArts Build 构建生命周期管理（dsh 插件形态）——本地编译构建、
  云端任务编排、执行控制、状态监控、产物获取、失败诊断。使用当用户提到
  CodeArts Build、CodeArtsBuild、构建任务、编译构建、build job、run build、
  build artifacts、构建产物、创建构建、执行构建、查看构建状态、构建失败分析。
triggers:
  - CodeArts Build
  - CodeArtsBuild
  - codeartsbuild
  - 构建任务
  - 编译构建
---

# CodeArtsBuild Skill（dsh 插件）

## 概述

本插件以 **dsh 插件（bundle）** 形态提供 16 个原子工具（清单见下），覆盖完整构建生命周期：

- **本地构建**（B）：`repo_build` —— 探测→编译指导→执行→产物→留档，编译过程由模型自决
- **云侧**：项目感知（A）/ 任务编排（C）/ 执行控制（D）/ 状态监控（E）/ 产物与日志（F/G）

底层华为云调用经 **KooCLI（hcloud）** 承载（AK/SK 由 `hcloud configure` 管理；例外：`list_artifacts` 的 `ShowNewOutput` 需手动 HTTP 调用）。

---

## 工具清单

| 工具 | 定义 | 关键入参 |
|------|------|----------|
| `codeartsbuild_repo_build` | 本地构建（探测/指导/执行/产物/留档内置） | repoPath, repoType?, buildCommandHint? |
| `codeartsbuild_list_projects` | 项目列表 | — |
| `codeartsbuild_list_jobs` | 任务列表（全局） | search?, pageIndex?, pageSize? |
| `codeartsbuild_get_job` | 任务详情 | jobId |
| `codeartsbuild_create_job` | 创建任务 | projectId（用户填写）, jobName, arch, steps, scms? |
| `codeartsbuild_update_job` | 更新任务 | jobId, body |
| `codeartsbuild_delete_job` | 删除任务（不可逆） | jobId |
| `codeartsbuild_list_templates` | 模板列表（官方模板） | name?, page?, pageSize? |
| `codeartsbuild_run_job` | 触发构建 | jobId, parameters?, scm? |
| `codeartsbuild_stop_job` | 停止构建 | jobId, buildNo |
| `codeartsbuild_get_status` | 状态查询（子步骤状态，待定） | jobId, buildNo |
| `codeartsbuild_list_records` | 构建历史列表 | projectId, limit?, offset? |
| `codeartsbuild_get_record` | 记录详情（含 record_id） | jobId, buildNo |
| `codeartsbuild_wait_build` | 等待终态（轮询） | jobId, buildNo |
| `codeartsbuild_list_artifacts` | 产物清单（软件包/镜像/OBS） | jobId, buildNo |
| `codeartsbuild_get_log` | 日志拉取+清洗 | recordId, logLevel?, maxBytes? |

---

## 强制规约（Mandatory —— 数据来源映射）

> 工具调用相互独立，可任意顺序调用。**强制约束：工具参数必须从正确前置渠道获取**，否则调用必然失败。

### 核心主键字段

依赖链：`project_id →(用户填写) create_job → job_id → run_job → build_no → get_record → record_id → get_log`

| 主键 | 获取方式 | 需要它的工具 |
|------|----------|--------------|
| **project_id** | **用户手动填写**；项目管理/维护后续拓展（TODO） | `create_job` / `list_records` |
| **job_id** | `create_job` 返回；或 `list_jobs` 按名称（`search`）搜索 | `get_job` / `update_job` / `delete_job` / `run_job` / `stop_job` / `get_status` |
| **build_no** | `run_job` 生成（每次构建独立，同 job 内递增） | `stop_job` / `wait_build` / `get_record` / `list_artifacts` / `get_status` |
| **record_id** | `get_record(jobId, buildNo)`（唯一来源） | `get_log` |

> `create_job` 的 steps 来源：`repo_build`（本地验证后）或 `list_templates`（官方模板）。

### 强制约束要点

1. **projectId 用户手动填写**：不自动选择、不硬编码；`list_projects` 仅作查看辅助。
2. **jobId+buildNo 必须配对**：5 个工具需同一构建的取值（同一次 `run_job` 返回或同一历史记录），不可混用。
3. **recordId 只能来自 `get_record`**。
4. **`delete_job` 不可逆**：调用前必须向用户确认。
5. **`get_log` 按需调用**：仅构建失败或用户显式要求。
6. **重试上限 3 轮**：异常修复自解限 3 轮，无果必须升级用户。

---

## 建议操作路径（Recommended —— 按用户意图编排）

以下为常见用户意图的推荐编排流程。**推荐路径可裁剪**：用户意图只覆盖部分阶段时，可跳过不相关环节。

### 意图 1：从零到完成（本地构建 → 云端任务 → 产物）

```
用户：帮我基于当前项目构建并交付（projectId 由用户提供）
repo_build → create_job → run_job → wait_build → list_artifacts
```

### 意图 2：仅本地构建（验证能否编译）

```
用户：这个仓库能编译吗？产物是什么
repo_build
（输出编译命令 + 产物信息 + 留档）
```

### 意图 3：仅云端已有任务（不本地构建）

```
用户：把已有任务跑一下
list_jobs / get_job → run_job → wait_build → list_artifacts
```

### 意图 4：指定分支/参数重新构建

```
用户：用 develop 分支重跑任务
get_job（确认任务）→ run_job(parameters=[{codeBranch, develop}])
    → wait_build → list_artifacts
```

### 意图 5：查看构建状态

```
用户：看看任务 xxx 现在什么状态
get_status（单次） 或 wait_build（等待终态）
```

### 意图 6：查询历史与产物

```
用户：昨天的构建结果和产物
list_records → get_record → list_artifacts
```

### 意图 7：构建失败诊断

```
用户：构建失败了，帮我看看原因
wait_build(FAILED) → get_record(取 record_id) → get_log → 日志清洗 → LLM 分析根因
    → 给出修复建议 → 修复后重试 repo_build / run_job | 无果升级用户
```

### 意图 8：配置管理

```
用户：改一下任务的构建配置 / 清理废弃任务
get_job → update_job（改配置）
list_jobs → delete_job（须确认后删）
```

---

## 配置（dsh 插件）

前置依赖：宿主机已安装并配置 **KooCLI（hcloud）**（AK/SK 经 `hcloud configure set` 管理，插件不接触凭据）。

```yaml
# cordis.patch.yml / profile 装配
plugins:
  - id: codeartsbuild
    name: '@dsh-codearts/codeartsbuild'
    config:
      region: cn-north-4
      # projectId 由用户手动填写（当前版本）；项目管理/维护后续版本拓展（TODO）
```

## 参考

- 架构设计：`../../docs/architecture.md`（v0.6）
- 工具契约：`../../docs/api-contract.md`（v0.4.3）
- 本地构建流程：`../../docs/repo-analyzer.md`（v0.2.1）
- 日志清洗规范：`../../docs/log-cleaner.md`（v0.2）
- [CodeArts Build API 参考](https://support.huaweicloud.com/api-codeci/cloudbuild_03_0000.html)
