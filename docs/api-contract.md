# CodeArtsBuild 插件 — 工具接口契约

> **文档编号**: CAB-CONTRACT-001  
> **版本**: v0.4.3（人工评审补充说明与接口调整）  
> **日期**: 2026-09-17  
> **状态**: 待人工评审确认  
> **前置依赖**: 架构设计 v0.6.0（`docs/architecture.md`）  

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-15 | 初始契约草案（16 个工具） |
| v0.2.0 | 2026-09-16 | 工具契约人工确定：基于 KooCLI v7.2.12 实测对齐；状态枚举去除 INITIALIZING/ABORTED |
| v0.3.0 | 2026-09-16 | **禁止使用过时/待下线/旧版接口**：新增 §1.4 接口禁用规则与禁用清单；各工具映射对齐到推荐接口 |
| v0.3.1 | 2026-09-16 | 恢复 §2 大标题；为 2.1-2.15 各工具补充实测 URL（Path） |
| v0.4.0 | 2026-09-16 | **工具全景与工作流**：移除 §2.16 旧版 analyze_repo，新增本地构建域工具；重写 §6 工作流编排（主流程/诊断/交互升级） |
| v0.4.1 | 2026-09-16 | **本地构建域收敛为 1 工具**：`repo_probe`/`repo_dependency`/`repo_artifact`/`repo_archive` 合并入 `repo_build`（探测+编译指导+执行+产物+留档内置），编译过程由模型自决 |
| v0.4.2 | 2026-09-16 | **统一命名规约**：新增 §1.2.1；重命名 `list_history`→`list_records`、`get_history_detail`→`get_record`、`wait_for_build`→`wait_build`、`get_build_log`→`get_log` |
| v0.4.3 | 2026-09-17 | **人工评审补充说明与接口调整**：各工具新增 `description` 字段（§2）；`get_record`→`ShowJobBuildRecordDetail`（v1）、`list_artifacts`→`ShowNewOutput`（v1 `/v1/job/{job_id}/{build_no}/output`，**KooCLI 未封装，需手动调用**）、`list_templates`→`ListOfficialTemplate`（v1）、`get_log`→`DownloadBuildFullLog`（v1）；`stop_job`/`get_status` 补充 buildNo；`list_projects`/`get_record` 更新为实测响应示例 |

---

## 1. 总则

### 1.1 契约目的

本文档是全部工具的唯一事实来源。**实现必须与本文档一致**；不一致视为缺陷。

### 1.2 通用约定

- **传输**：dsh 插件（主）原生注册工具；独立 MCP Server（辅）经 `dsh-mcp-client` 或 stdio 接入，共用同一契约
- **华为云调用**：所有工具底层经 KooCLI（`hcloud`，实测 v7.2.12）执行
- **错误返回**：所有工具失败统一返回错误格式（见 §3）
- **字段命名**：JSON 输出使用 camelCase（与工具调用惯例一致），KooCLI 原始输出中的 snake_case 字段经适配层转换

### 1.2.1 工具命名规约（2026-09-16 评审确认）

工具名 = `codeartsbuild_` + **动词前缀** + `_` + **对象名**（单数/复数按语义）：

| 前缀 | 语义 | 工具 |
|------|------|------|
| `list_` | 列表查询（返回集合） | `list_projects` / `list_jobs` / `list_records` / `list_artifacts` / `list_templates` |
| `get_` | 单条详情/状态查询 | `get_job` / `get_record` / `get_status` / `get_log` |
| `create_` / `update_` / `delete_` | CRUD 操作 | `create_job` / `update_job` / `delete_job` |
| `run_` / `stop_` | 执行控制 | `run_job` / `stop_job` |
| `wait_` | 等待终态 | `wait_build` |
| `repo_` | 本地构建域 | `repo_build` |

**对象名**：`projects` / `jobs` / `record` / `records` / `artifacts` / `templates` / `status` / `log` / `build`

**规约要点**：
- 列表类用复数对象（`list_*s`），详情类用单数（`get_*`）
- 新增工具须按此规约命名，违者视为契约缺陷

### 1.3 KooCLI 实测说明

**服务名**：`CodeArtsBuild`（实测 `hcloud CodeArtsBuild --help` 确认）
**命令格式**：`hcloud CodeArtsBuild <Operation> --cli-region=<region> --param=value ...`

已实测确认的操作与参数见 §2 各工具。`record_id` 获取路径见 §2.15 备注（待实调用验证）。

### 1.4 接口禁用规则（过时 / 待下线 / 旧版）

> **评审决策**：禁止使用过时、编译构建(待下线)、编译构建(旧)相关的接口。KooCLI 操作列表中大量功能重叠的操作需甄别，仅使用**推荐接口**。

#### 1.4.0 版本体系判定（2026-09-16 实测 Path 确认）

**CodeArtsBuild 接口版本体系**：**v1/v4 为新接口（优先使用），v3 为旧版接口（禁止使用）**。

> 判定依据：KooCLI 缓存服务定义（`~/.hcloud/metaRepo/template/codeartsbuild/*.yaml`）中 `Request.Path` 字段实测。示例：
> - `ExecuteJob` → `/v1/job/execute`（新）
> - `RunJob` → `/v3/jobs/build`（旧）
> - `ShowRecordDetail` → `/v4/jobs/{job_id}/{build_no}/record-info`（新）
> - `ShowRecordInfo` → `/v3/jobs/{job_id}/{build_no}/record-info`（旧，待下线）

#### 1.4.1 v3 旧版接口（禁用）

以下接口 Path 为 `/v3/...`，属**编译构建旧版接口**，**禁止使用**：

| 禁用接口 | Path（实测） | 推荐替代（v1/v4） |
|----------|--------------|-------------------|
| `CreateBuildJob` | `/v3/jobs/create` | `CreateNewJob`（`/v1/job/create`） |
| `RunJob` | `/v3/jobs/build` | `ExecuteJob`（`/v1/job/execute`） |
| `UpdateBuildJob` | `/v3/jobs/update` | `UpdateNewJob`（`/v1/job/update`） |
| `DeleteBuildJob` | `/v3/jobs/{id}/delete` | `DeleteTheJob`（`/v1/job/{id}/delete`） |
| `StopJob` | `/v3/jobs/stop` | `StopTheJob`（`/v1/job/{id}/stop`） |
| `StopBuildJob` | `/v3/jobs/{id}/{no}/stop` | `StopTheJob`（`/v1/job/{id}/stop`） |
| `ListJobConfig` | `/v3/jobs/{id}/query` | `ShowJobConfig`（`/v1/job/{id}/config`） |
| `ShowJobStatus` | `/v3/jobs/{id}/status` | `ShowJobStepStatus`（`/v1/job/{id}/status`）/ `ShowRunningStatus`（`/v1/job/{id}/running-status`） |
| `ShowListHistory` | `/v3/jobs/{id}/history` | `ListRecords`（`/v1/record/{project_id}/records`） |
| `ShowLastHistory` | `/v3/jobs/{project_id}/last-history` | `ListRecords` |
| `ShowListPeriodHistory` | `/v3/jobs/{id}/period-history` | `ListRecords` |
| `ShowHistoryDetails` | `/v3/jobs/{id}/{no}/history-details` | `ShowRecordDetail`（`/v4/jobs/{id}/{no}/record-info`） |
| `ShowRecordInfo` | `/v3/jobs/{id}/{no}/record-info` | `ShowRecordDetail`（`/v4/...`） |
| `ShowOutputInfo` | `/v3/jobs/{id}/{no}/output-info` | 产物：`ShowNewOutput`（`/v1/job/{id}/{no}/output`，KooCLI 未封装，需手动调用） |
| `ShowJobListByProjectId` | `/v3/{project_id}/jobs` | `ListProjectJobs`（`/v1/job/{project_id}/list`） |
| `ListBuildInfoRecord` | `/v3/jobs/{id}/build-info-records` | `ListBuildInfoRecordByJobId`（`/v1/record/{id}/list`） |
| `ShowJobSuccessRatio` | `/v3/jobs/{id}/success-ratio` | `ShowJobBuildSuccessRatio`（`/v1/report/ratio`） |
| `DownloadLogByRecordId` | `/v3/{record_id}/download-log` | `DownloadBuildLog`（`/v4/{record_id}/download-log`） |
| `DownloadRealTimeLog` | `/v3/jobs/{id}/{no}/real-time-log` | `DownloadBuildRealTimeLog`（`/v1/log/{id}/{no}/real-time-log`） |
| `ListNotice` | `/v3/jobs/notice/{id}/query` | `ShowJobNoticeConfigInfo`（`/v1/job/{id}/notice`） |
| `ListTemplates` | `/v3/templates/query` | `ListCustomTemplate`（`/v1/template/custom`）/ `ListOfficialTemplate`（`/v1/template/officialtemplates`） |

#### 1.4.2 v1/v4 新接口（优先使用）

以下接口 Path 为 `/v1/...` 或 `/v4/...`，属**新接口**，**优先使用**：

```
CreateNewJob (/v1/job/create)          UpdateNewJob (/v1/job/update)
DeleteTheJob (/v1/job/{id}/delete)     ExecuteJob (/v1/job/execute)
StopTheJob (/v1/job/{id}/stop)         ListJob (/v1/job/list)
ListProjectJobs (/v1/job/{pid}/list)   ShowJobConfig (/v1/job/{id}/config)
ShowJobInfo (/v1/job/{id}/info)        ShowJobStepStatus (/v1/job/{id}/status)
ShowRunningStatus (/v1/job/{id}/running-status)
ShowJobNoticeConfigInfo (/v1/job/{id}/notice)
ShowJobPipelineInfo (/v1/job/{id}/pipeline-info)
ShowRelatedProject (/v1/domain/project/related)
ListBriefRecord (/v1/record/brief)     ListRecords (/v1/record/{pid}/records)
ListBuildInfoRecordByJobId (/v1/record/{id}/list)
ShowBuildInfoRecord (/v1/record/{id}/{no}/build-info-record)
ShowBuildRecord (/v1/record/{record_id}/info)
ShowJobBuildRecordDetail (/v1/record/{id}/{no}/record-info)
ShowBuildDetails (/v1/job/{id}/{no}/build-info)
ShowJobBuildSuccessRatio (/v1/report/ratio)   ShowJobBuildTime (/v1/report/time)
ListCustomTemplate (/v1/template/custom)      ListOfficialTemplate (/v1/template/officialtemplates)
ShowTemplate (/v1/template/{uuid}/custom)     ShowYamlTemplate (/v1/template/{id}/default-template)
DownloadBuildFullLog (/v1/log/{record_id}/download-log)
DownloadBuildRealTimeLog (/v1/log/{id}/{no}/real-time-log)
ShowNewOutput (/v1/job/{id}/{no}/output，KooCLI 未封装，需手动调用)
ShowRecordDetail (/v4/jobs/{id}/{no}/record-info)
DownloadBuildLog (/v4/{record_id}/download-log)
DownloadTaskLog (/v4/{record_id}/task-log)
```

#### 1.4.3 推荐接口白名单（工具映射）

插件**仅使用**以下推荐接口（各工具映射见 §2）：

```
v1: ShowRelatedProject, ListJob, ListProjectJobs, ShowJobConfig, CreateNewJob,
    UpdateNewJob, DeleteTheJob, ExecuteJob, StopTheJob, ShowJobStepStatus,
    ShowRunningStatus, ListRecords, ListBriefRecord, ListBuildInfoRecordByJobId,
    ShowBuildInfoRecord, ShowJobBuildRecordDetail, ShowJobBuildSuccessRatio,
    ListCustomTemplate, ListOfficialTemplate, DownloadBuildFullLog,
    ShowNewOutput（KooCLI 未封装，经手动 HTTP 调用，仅 list_artifacts 使用）
v4: ShowRecordDetail, DownloadBuildLog
```

> 判定原则：**v3 Path 一律禁用**；v1/v4 优先；新增工具映射前须按 `hcloud` 服务定义核对 Path 版本。

> ⚠️ 注意：`DownloadBuildFullLog`(v1) 与 `DownloadBuildLog`(v4) 均为「下载全量构建日志」，**评审决策（2026-09-17）：`get_log` 使用 `DownloadBuildFullLog`（v1 `/v1/log/{record_id}/download-log`）**；`DownloadBuildRealTimeLog`(v1) 为实时日志。

---

## 2. 工具契约

> 以下各工具标注的 **KooCLI 操作** 与 **URL（Path）** 均为 2026-09-16 KooCLI v7.2.12 实测（`~/.hcloud/metaRepo/template/codeartsbuild/*.yaml` 的 `Request.Path`）。完整请求地址 = `https://{endpoint}{Path}`，endpoint 由 `--cli-region` 决定。

### 2.0 工具速查表（20 个）

**本地构建域（B. 代码仓构建）—— 收敛为 1 工具**

| # | 工具名称 | 定义 | 使用场景 |
|---|----------|------|----------|
| 2.16 | `codeartsbuild_repo_build` | 本地构建（唯一）：探测仓库类型→编译指导→执行编译→产物收集→留档 内置 | AI 自主编译代码仓；编译过程由模型自行判断 |

**云侧·项目感知（A）**

| # | 工具名称 | 定义 | 使用场景 |
|---|----------|------|----------|
| 2.1 | `codeartsbuild_list_projects` | 项目列表（v1 `ShowRelatedProject`） | 创建任务前选择 projectId |
| 2.2 | `codeartsbuild_list_jobs` | 任务列表（v1 `ListJob`） | 查看/搜索已有任务 |
| 2.3 | `codeartsbuild_get_job` | 任务详情（v1 `ShowJobConfig`） | 查看/评估任务配置 |

**云侧·任务编排（C）**

| # | 工具名称 | 定义 | 使用场景 |
|---|----------|------|----------|
| 2.4 | `codeartsbuild_create_job` | 创建任务（v1 `CreateNewJob`） | 本地构建配置落到云端 |
| 2.5 | `codeartsbuild_update_job` | 更新任务（v1 `UpdateNewJob`） | 修改任务配置 |
| 2.6 | `codeartsbuild_delete_job` | 删除任务（v1 `DeleteTheJob`），不可逆 | 废弃任务清理（须确认） |
| 2.13 | `codeartsbuild_list_templates` | 官方模板列表（v1 `ListOfficialTemplate`） | create_job 前发现步骤配置 |

**云侧·执行控制（D）**

| # | 工具名称 | 定义 | 使用场景 |
|---|----------|------|----------|
| 2.7 | `codeartsbuild_run_job` | 触发构建（v1 `ExecuteJob`） | 启动云端构建，返回 build_number |
| 2.8 | `codeartsbuild_stop_job` | 停止构建（v1 `StopTheJob`） | 误触发/超时终止 |

**云侧·状态监控（E）**

| # | 工具名称 | 定义 | 使用场景 |
|---|----------|------|----------|
| 2.9 | `codeartsbuild_get_status` | 状态查询（v1 `ShowJobStepStatus`） | 快速查看当前状态 |
| 2.10 | `codeartsbuild_list_records` | 历史列表（v1 `ListRecords`） | 查看历史记录 |
| 2.11 | `codeartsbuild_get_record` | 记录详情（v1 `ShowJobBuildRecordDetail`），含 build_record_id/execution_id/devcloud_project_id | 失败定位；取记录 ID 供日志下载 |
| 2.14 | `codeartsbuild_wait_build` | 等待终态（轮询 `ShowJobStepStatus`） | 阻塞等待构建完成 |

**云侧·产物/日志（F/G）**

| # | 工具名称 | 定义 | 使用场景 |
|---|----------|------|----------|
| 2.12 | `codeartsbuild_list_artifacts` | 产物清单（v1 `ShowNewOutput`，KooCLI 未封装手动调用），软件包/镜像/OBS 三类 | 交付构建结果 |
| 2.15 | `codeartsbuild_get_log` | 日志拉取+清洗（v1 `DownloadBuildFullLog`） | 仅失败/显式要求时；供 LLM 分析 |

### 2.1 codeartsbuild_list_projects

获取当前用户可见的 CodeArts 项目列表。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_list_projects` |
| **场景** | A. 项目感知 |
| **描述** | 无参，返回当前用户下有权限的项目列表；响应中 `identifier` 即 projectId，`name` 即 projectName |
| **KooCLI 操作** | `ShowRelatedProject`（GET） |
| **URL** | `/v1/domain/project/related` |

**输入参数**：无

**输出示例**（实测响应）：

```json
{
  "result": {
    "total": 10,
    "project_info_list": [
      {
        "identifier": "3xx235c31ae44fb4bb410d875b750xxd",
        "name": "测试开发项目",
        "status": null,
        "author_id": "6dxx54d45bf44a0684a7a682f719xxd9",
        "is_creator": true,
        "author_domain_id": "764xx3980afc4e5c97a1a9a73c1dxx7a"
      }
    ]
  },
  "error": null,
  "status": "success"
}
```

> 字段映射：`result.project_info_list[].identifier` → projectId，`name` → projectName。

---

### 2.2 codeartsbuild_list_jobs

列出构建任务列表（**全局**，不按项目过滤——ListJob 无 project_id 参数）。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_list_jobs` |
| **场景** | A. 项目感知 |
| **描述** | 全局构建任务搜索；`search` 为核心按任务名称搜索字段；响应中 `id` 即 jobId |
| **KooCLI 操作** | `ListJob`（GET） |
| **URL** | `/v1/job/list` |

**输入参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| pageIndex | number | ❌ | 0 | 分页页码（page_index ≥ 0） |
| pageSize | number | ❌ | 20 | 每页条数（page_size ≤ 100） |
| search | string | ❌ | — | **核心搜索字段**：按任务名称关键字搜索 |
| buildStatus | string | ❌ | — | 构建状态过滤 |

> 注：原契约的 `projectId` 参数移除——实测 `ListJob` 无项目维度参数。若需项目维度筛选，可先 `list_projects` 后用 `search` 或按返回的 project 字段过滤。

**输出示例**：

```json
{
  "jobs": [
    {
      "id": "2fd1f3031a9947b69ba094ce284344eb",
      "job_name": "demo-maven-build",
      "job_type": "maven",
      "project_id": "8c6b8f4c2a1e4f0d9b3a5e7f8c1d2e3f",
      "last_build_status": "SUCCESS",
      "last_build_time": "2026-09-15T10:30:00Z",
      "last_build_number": 12
    }
  ],
  "total": 1,
  "page_index": 0,
  "page_size": 20
}
```

> 字段映射：`jobs[].id` → jobId。

---

### 2.3 codeartsbuild_get_job

获取单个构建任务的完整配置。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_get_job` |
| **场景** | A. 项目感知 / C. 任务编排 |
| **描述** | 按 jobId 查询构建任务详情；`steps` 为构建步骤，`scms` 为构建代码仓，`parameters` 为构建参数 |
| **KooCLI 操作** | `ShowJobConfig`（GET） |
| **URL** | `/v1/job/{job_id}/config` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID |

**输出示例**：

```json
{
  "id": "2fd1f3031a9947b69ba094ce284344eb",
  "job_name": "demo-maven-build",
  "project_id": "8c6b8f4c2a1e4f0d9b3a5e7f8c1d2e3f",
  "scms": [
    { "scm_type": "Repo", "repo_id": "repo-uuid", "repo_name": "demo-repo", "branch": "master" }
  ],
  "steps": [
    { "module_id": "maven", "name": "Maven 构建", "command": "mvn package -DskipTests" }
  ],
  "parameters": [
    { "name": "codeBranch", "value": "master" }
  ]
}
```

---

### 2.4 codeartsbuild_create_job

创建新的构建任务。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_create_job` |
| **场景** | C. 任务编排 |
| **描述** | 创建任务（入参较复杂），**后续要模板化**：常用构建步骤提供模板创建（maven / npm / gradle / python / go），支持上传软件包、上传镜像、上传 OBS、下载 OBS |
| **KooCLI 操作** | `CreateNewJob`（POST） |
| **URL** | `/v1/job/create` |
| **注意** | 调用前先 `repo_build` 完成本地构建验证，或 `list_templates` 获取可用模板；**`arch` 为必填**；模板化改造落地前，模型按 `list_templates` 返回的官方模板组装 steps |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| arch | string | ✅ | 机器架构（如 x86_64 / aarch64） |
| jobName | string | ✅ | 任务名称 |
| projectId | string | ✅ | 项目 ID |
| steps | array | ✅ | 构建步骤，每项含 `module_id` + `name`（必填），可选 `command` 等 |
| scms | array | ❌ | 代码源，每项含 `scm_type`/`repo_id`/`repo_name`/`branch` 等 |
| parameters | array | ❌ | 自定义参数 |
| description | string | ❌ | 任务描述 |
| flavor | string | ❌ | 执行机规格 |

**steps 必填项**（实测确认）：

```
--steps.1.module_id=xxx   （构建模块 id）
--steps.1.name=xxx        （构建模块名称）
```

**输出示例**：

```json
{
  "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
  "job_name": "demo-maven-build",
  "created": true
}
```

---

### 2.5 codeartsbuild_update_job

更新已有构建任务。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_update_job` |
| **场景** | C. 任务编排 |
| **描述** | 接口入参与 create 相同，另需原任务 jobId；**不支持增量修改**（全量覆盖提交） |
| **KooCLI 操作** | `UpdateNewJob`（POST，参数与 CreateNewJob 同构） |
| **URL** | `/v1/job/update` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID（原任务） |
| body | object | ✅ | 与 create 同构的可修改配置片段（全量覆盖，非增量） |

**输出示例**：

```json
{
  "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
  "updated": true
}
```

---

### 2.6 codeartsbuild_delete_job

删除构建任务。**不可逆，调用前必须与用户确认**。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_delete_job` |
| **场景** | C. 任务编排 |
| **描述** | 按 jobId 删除任务；不可逆 |
| **KooCLI 操作** | `DeleteTheJob`（POST） |
| **URL** | `/v1/job/{job_id}/delete` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID |

**输出示例**：

```json
{
  "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
  "deleted": true
}
```

---

### 2.7 codeartsbuild_run_job

触发构建任务执行。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_run_job` |
| **场景** | D. 执行控制 |
| **描述** | 按 jobId 执行任务，可动态传参（构建参数、仓库信息）；执行成功返回 jobId、buildNo |
| **KooCLI 操作** | `ExecuteJob`（POST） |
| **URL** | `/v1/job/execute` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID |
| parameters | array | ❌ | 参数覆盖，`[{name, value}]` |
| scm | object | ❌ | 仓库信息 `{build_commit_id?, build_tag?}`（实测无 build_branch；分支经 parameters 传递） |

> **分支指定方式（实测）**：`ExecuteJob` 的 scm 仅支持 `build_commit_id` 与 `build_tag`。指定分支应通过 `parameters` 传入（如 `{name: "codeBranch", value: "develop"}`），或直接使用任务的默认分支。

**输出示例**：

```json
{
  "job_id": "2fd1f3031a9947b69ba094ce284344eb",
  "buildNo": 13,
  "status": "QUEUED"
}
```

---

### 2.8 codeartsbuild_stop_job

停止运行中的构建。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_stop_job` |
| **场景** | D. 执行控制 |
| **描述** | 按 jobId、buildNo 停止任务 |
| **KooCLI 操作** | `StopTheJob`（POST） |
| **URL** | `/v1/job/{job_id}/stop` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID |
| buildNo | number | ✅ | 构建编号（停止指定一次构建） |

**输出示例**：

```json
{
  "job_id": "2fd1f3031a9947b69ba094ce284344eb",
  "build_no": 13,
  "stopped": true
}
```

---

### 2.9 codeartsbuild_get_status

查询构建运行状态。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_get_status` |
| **场景** | E. 状态监控 |
| **描述** | 按 jobId、buildNo 查询任务状态；返回为**各子步骤的任务状态**，较难解析，**考虑替换为其他接口（待定）** |
| **KooCLI 操作** | `ShowJobStepStatus`（GET） |
| **URL** | `/v1/job/{job_id}/status` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID |
| buildNo | number | ✅ | 构建编号 |

**输出示例**：

```json
{
  "job_id": "2fd1f3031a9947b69ba094ce284344eb",
  "status": "RUNNING",
  "result": null,
  "build_number": 13,
  "start_time": "2026-09-15T10:30:00Z"
}
```

**状态枚举**：见 §4（已去除 INITIALIZING / ABORTED）。

---

### 2.10 codeartsbuild_list_records

列出构建任务的历史记录。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_list_records` |
| **场景** | E. 状态监控 |
| **KooCLI 操作** | `ListRecords`（GET） |
| **URL** | `/v1/record/{build_project_id}/records` |

**输入参数**（实测：build_project_id 为 path 必填；limit/offset 需确认）：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| buildProjectId | string | ✅ | — | 项目 ID（path） |
| limit | number | ❌ | 20 | 每页条数（≤100） |
| offset | number | ❌ | 0 | 分页页码（≥0） |

**输出示例**：

```json
{
  "records": [
    {
      "record_id": "rec-7f8c1d2e",
      "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
      "build_no": 13,
      "start_time": "2026-09-15T10:30:00Z",
      "end_time": "2026-09-15T10:35:20Z",
      "result": "SUCCESS",
      "trigger_type": "MANUAL"
    }
  ],
  "total": 13
}
```

---

### 2.11 codeartsbuild_get_record

获取某条构建记录详情。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_get_record` |
| **场景** | E. 状态监控 / F. 产物管理 |
| **描述** | 按 jobId、buildNo 获取构建记录详情；含 `build_record_id`（构建记录查询）、`execution_id`（日志查询）、`devcloud_project_id`（project_id） |
| **KooCLI 操作** | `ShowJobBuildRecordDetail`（GET，实测） |
| **URL** | `/v1/record/{job_id}/{build_no}/record-info` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID |
| buildNo | number | ✅ | 构建编号 |

**输出示例**（实测响应）：

```json
{
  "status": "success",
  "error": null,
  "result": {
    "id": "eb9d73c7-61b3-4823-b476-a7c00c493b8a",
    "build_project_id": "31581e9f-5772-4053-a50c-d5690578c8fd",
    "build_record_id": "9d6169b9-022d-458c-9dc8-48cc94cc4083",
    "parent_record_id": null,
    "devcloud_project_id": "b4d3971c3988463b865f6f920846149e",
    "codeci_job_id": "68491d9bc97b4774adb93e29b46d2dc6",
    "user_id": "ae22fd035f354cfa8d82a3f1c8940446",
    "build_no": 532,
    "daily_build_num": "20221011.29",
    "execution_id": "j_YE1bu9Z7",
    "repo_name": "maven",
    "repo_id": "2111616838",
    "branch": "buildflow_env",
    "tag": null,
    "commit": null,
    "commit_message": null,
    "commit_create_time": "2022-10-11T08:28:42.000+00:00",
    "trigger_type": "MANUAL",
    "build_type": "branch",
    "status": "SUCCESS",
    "domain_id": "60021bab32fd450aa2cb89226f425e06",
    "create_time": "2022-10-11T08:28:42.000+00:00",
    "schedule_time": "2022-10-11T08:28:45.000+00:00",
    "queued_time": "2022-10-11T08:28:45.000+00:00",
    "start_time": "2022-10-11T08:28:47.000+00:00",
    "runnable_time": "2022-10-11T08:16:04.000+00:00",
    "finish_time": "2022-10-11T08:30:27.000+00:00",
    "duration": 100068,
    "record_status": null,
    "use_private_slave": 0,
    "region": "xx-xxxx-xx",
    "err_msg": null,
    "build_config_type": "YAML"
  }
}
```

> **字段用途**：`result.build_record_id` → 构建记录查询（record_id，供日志下载）；`result.execution_id` → 日志查询；`result.devcloud_project_id` → project_id。

---

### 2.12 codeartsbuild_list_artifacts

列出某次构建产生的产物（**软件包产物 / 镜像产物 / OBS 产物**）。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_list_artifacts` |
| **场景** | F. 产物管理 |
| **描述** | 按 jobId、buildNo 查询产物信息；产物分为软件包产物、镜像产物、OBS 产物三类 |
| **KooCLI 操作** | `ShowNewOutput`（GET）——**该接口在 KooCLI 中不存在，需手动调用**（原生 HTTP 或 `cdo api`，复用同一 token） |
| **URL** | `/v1/job/{job_id}/{build_no}/output` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID |
| buildNo | number | ✅ | 构建编号 |

**输出示例**：

```json
{
  "result": {
    "package_info": [
      {
        "name": "demo-1.0.0.jar",
        "uri": "cloudartifact://demo-project/demo/1.0.0/demo-1.0.0.jar"
      }
    ],
    "image_info": [
      { "name": "demo-image", "tag": "1.0.0", "uri": "swr.cn-xx-xx/demo/demo-image:1.0.0" }
    ],
    "obs_info": [
      { "name": "demo-output.zip", "uri": "obs://demo-bucket/demo-output.zip" }
    ]
  }
}
```

> `package_info` / `image_info` / `obs_info` 的实际字段名与结构以 `ShowNewOutput` 实调用响应为准（架构 §12 待确认 #2）；接口未封装于 KooCLI，实现时走手动 HTTP 调用。

---

### 2.13 codeartsbuild_list_templates

列出可用构建模板（**官方模板**）。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_list_templates` |
| **场景** | C. 任务编排（配置发现） |
| **描述** | 查询**官方模板**（`ListOfficialTemplate`）；用户自建模板用 `ListCustomTemplate`（`/v1/template/custom`）查询 |
| **KooCLI 操作** | `ListOfficialTemplate`（GET，实测） |
| **URL** | `/v1/template/officialtemplates` |

**输入参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| name | string | ❌ | — | 模板名称过滤 |
| page | number | ❌ | 1 | 页码（≥1） |
| pageSize | number | ❌ | 20 | 每页条数（≤100） |
| tags | string | ❌ | — | 标签过滤 |

**输出示例**：

```json
{
  "templates": [
    {
      "name": "Maven",
      "description": "Maven 构建并上传软件包",
      "language": "Java",
      "steps": [
        { "module_id": "maven", "name": "Maven 构建", "default_command": "mvn package" }
      ]
    }
  ]
}
```

> **模板来源区分**：`ListOfficialTemplate`（v1 `/v1/template/officialtemplates`）查官方模板；`ListCustomTemplate`（v1 `/v1/template/custom`）查用户自建模板。create_job 模板化组装默认用官方模板。

---

### 2.14 codeartsbuild_wait_build

轮询等待构建进入终态。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_wait_build` |
| **场景** | E. 状态监控 |
| **描述** | 按 jobId、buildNo 查询任务状态并轮询直至终态 |
| **KooCLI 操作** | 内部循环调用 `ShowJobStepStatus` |
| **URL** | `/v1/job/{job_id}/status` |

**输入参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| jobId | string | ✅ | — | 构建任务 ID |
| buildNo | number | ✅ | — | 构建编号 |
| intervalMs | number | ❌ | 10000 | 轮询间隔（2000~120000） |
| timeoutMs | number | ❌ | 1800000 | 超时（默认 30 分钟） |

**输出示例**：

```json
{
  "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
  "build_no": 13,
  "status": "FAILED",
  "start_time": "2026-09-15T10:30:00Z",
  "end_time": "2026-09-15T10:35:20Z"
}
```

**行为**：终态立即返回；超时抛 `E_TIMEOUT`；`status=FAILED` 时 LLM 继续走 G2（`get_log` → 清洗 → 分析）。

---

### 2.15 codeartsbuild_get_log

**获取构建日志（清洗建模）。仅 error 分析场景调用。**

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_get_log` |
| **场景** | G. 故障诊断 |
| **描述** | 基于 record_id 查询构建日志（全量） |
| **KooCLI 操作** | `DownloadBuildFullLog`（GET，log_level 可选 INFO\|DEBUG，实测） |
| **URL** | `/v1/log/{record_id}/download-log` |
| **调用约束** | 仅在构建失败或用户显式要求日志时调用 |

**输入参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| recordId | string | ✅ | — | 记录 ID（来自 get_record 的 `build_record_id`，36 位 UUID） |
| logLevel | string | ❌ | INFO | 日志等级（INFO\|DEBUG） |
| maxBytes | number | ❌ | 262144 | 日志截断上限（默认 256 KB） |

**输出示例**：

```json
{
  "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
  "record_id": "7f8c1d2e-...-36位uuid",
  "byte_size": 1572864,
  "truncated": true,
  "raw_sample": "[INFO] ...\n[ERROR] COMPILATION ERROR:\n...",
  "structured": [
    {
      "phase": "build",
      "level": "error",
      "content": "Demo.java:42: error: cannot find symbol",
      "line_range": [41, 43]
    }
  ],
  "error_summary": {
    "phase": "build",
    "error_type": "COMPILE_ERROR",
    "message": "cannot find symbol: method getDemo()",
    "line": 42,
    "context": "  return demo.getDemo();\n         ^"
  }
}
```

**大日志策略**：HEAD + TAIL + 错误上下文三区采样；`truncated=true` 时提示用户控制台查看全文。

---

### 2.16 codeartsbuild_repo_build

**本地构建**（本地构建域，唯一工具）：执行代码仓编译构建，内部完成类型探测、编译指导、命令执行、产物收集、过程留档；实际编译过程由模型自行判断。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_repo_build` |
| **场景** | B. 代码仓构建 |
| **实现** | `src/infra/local-build/build.ts`——内部步骤：① `fs` 探测仓库类型/语言/构建工具（可选探测，仓库类型未传时自动）；② 按仓库类型给出**编译指导**（参考命令 + 注意点）；③ `child_process.spawn` 执行编译（命令由模型传入或参考指导），收集 stdout/stderr 尾部（各 4KB），退出码判定成功/失败；④ 失败时正则匹配 stderr 分类异常（见 repo-analyzer.md §5.1）；⑤ 成功后按工具默认 patterns 用 `glob` 扫描产物（`target/*.jar`/`dist/*`/`build/*`）；⑥ 自动留档到 `.codeartsbuild/build-records/`。不经 KooCLI。 |

**输入参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| repoPath | string | ✅ | — | 本地仓库地址 |
| repoType | string | ❌ | 自动探测 | 仓库类型（如 `maven`/`gradle`/`npm`/`go`/`python`/`docker`），缺省时工具自动探测 |
| buildCommandHint | string | ❌ | — | 参考编译命令（模型已判明时传入；缺省由工具按仓库类型给出编译指导） |
| timeoutMs | number | ❌ | 1800000 | 超时（默认 30 分钟） |

**输出示例**：

```json
{
  "status": "SUCCESS",
  "repo_path": "D:/code/ai/demo",
  "repo_type": "maven",
  "build_command": "mvn package -DskipTests",
  "build_guidance": "Maven 项目：参考命令 `mvn package -DskipTests`；产物默认输出于 target/ 目录",
  "exit_code": 0,
  "stdout_tail": "[INFO] BUILD SUCCESS...",
  "stderr_tail": "",
  "duration_seconds": 120,
  "artifacts": [
    { "name": "demo-1.0.0.jar", "path": "target/demo-1.0.0.jar", "type": "jar", "size_bytes": 245760 }
  ],
  "archived": {
    "record_id": "2026-09-16_100000",
    "path": ".codeartsbuild/build-records/2026-09-16_100000.json"
  }
}
```

**失败时**：

```json
{
  "status": "FAILED",
  "repo_path": "D:/code/ai/demo",
  "repo_type": "maven",
  "build_command": "mvn package -DskipTests",
  "exit_code": 1,
  "error": {
    "error_type": "DEPENDENCY_MISSING",
    "error_code": null,
    "message": "Could not resolve dependencies...",
    "context": "mvn package 前 2 行"
  },
  "stdout_tail": "...",
  "stderr_tail": "Could not resolve...",
  "archived": { "record_id": "2026-09-16_100100", "path": ".codeartsbuild/build-records/2026-09-16_100100.json" }
}
```

**模型自决规约**（见 repo-analyzer.md §4）：
- 编译命令：模型基于仓库类型/编译指导自行判断传入 `buildCommandHint`；未传入时工具按仓库类型给出参考指导
- 异常修复：`status=FAILED` 返回结构化错误 → 模型自行判断修复策略（用通用 bash 能力装依赖/修正命令后重调本工具）；修复无果 → 通知用户交互
- 探测与留档：工具内部完成，模型无需单独关心

---

## 3. 错误契约

### 3.1 错误返回格式（统一）

```json
{
  "content": [{ "type": "text", "text": "错误描述（含错误码与详情）" }],
  "isError": true
}
```

**text 规范**：`[错误码] 人类可读描述\n详情: <KooCLI/API 返回详情>`

### 3.2 错误码表

| 错误码 | 含义 | 典型触发 | 建议处理 |
|--------|------|----------|----------|
| `E_CONFIG` | 配置缺失/非法 | KooCLI 未安装、region 未配置 | 提示安装/配置 hcloud |
| `E_AUTH` | 认证失败 | AK/SK 失效、无权限 | 提示检查 `hcloud configure` |
| `E_PARAM` | 参数校验失败 | 必填缺失、类型错误 | 返回字段级错误列表 |
| `E_API` | CodeArtsBuild 业务错误 | 任务不存在、重名 | 透传 KooCLI 错误码 |
| `E_NETWORK` | 网络异常 | 超时、连接失败 | 幂等命令重试 ≤3 次 |
| `E_TIMEOUT` | 构建等待超时 | wait_build 超时 | 返回当前状态 |
| `E_LOG` | 日志处理错误 | 日志过大、下载失败 | 返回 console_url |

---

## 4. 状态枚举（v0.2 修订）

### 4.1 构建状态（status）

| 值 | 阶段 | 说明 |
|----|------|------|
| `QUEUED` | 排队 | 已提交待执行 |
| `RUNNING` | 运行中 | 正在执行构建步骤 |
| `SUCCESS` | 终态 | 构建成功 |
| `FAILED` | 终态 | 构建失败（触发 G2 诊断） |
| `ERROR` | 终态 | 构建异常 |
| `CANCELED` | 终态 | 用户取消 |
| `COMPLETED` | 终态 | 已完成 |

> **修订说明**：去除 `INITIALIZING`（实际状态由 QUEUED→RUNNING 覆盖）与 `ABORTED`（由 CANCELED 覆盖）。终态集合相应更新。

### 4.2 终态判定集合

```
{ SUCCESS, FAILED, ERROR, CANCELED, COMPLETED }
```

---

## 5. 日志错误分类表

| error_type | 匹配模式 | 典型场景 |
|------------|----------|----------|
| `COMPILE_ERROR` | `cannot find symbol` / `COMPILATION ERROR` / `error:` | 编译失败 |
| `DEPENDENCY_MISSING` | `Could not resolve` / `dependency not found` | 依赖缺失 |
| `TEST_FAILURE` | `Tests run:.*Failures` / `BUILD FAILURE.*test` | 测试失败 |
| `TIMEOUT` | `timeout` / `Timed out` / `exceeded` | 构建超时 |
| `OOM` | `OutOfMemoryError` / `Killed` / `memory limit` | 内存不足 |
| `PERMISSION_DENIED` | `403` / `Forbidden` / `unauthorized` | 权限不足 |
| `SCRIPT_ERROR` | `Command exited with` / `exit code` | 脚本失败 |
| `UNKNOWN` | 其他 ERROR 级别 | 兜底 |

---

## 6. 工具注册全景与工作流编排

### 6.1 工具注册全景（16 个原子工具）

| 域 | 工具 | 场景 |
|----|------|------|
| **本地构建域** | `repo_build`（探测+编译指导+执行+产物+留档 内置） | B. 代码仓构建 |
| **云侧·项目感知** | `list_projects` / `list_jobs` / `get_job` | A. 项目感知 |
| **云侧·任务编排** | `create_job` / `update_job` / `delete_job` / `list_templates` | C. 任务编排 |
| **云侧·执行控制** | `run_job` / `stop_job` | D. 执行控制 |
| **云侧·状态监控** | `get_status` / `list_records` / `get_record` / `wait_build` | E. 状态监控 |
| **云侧·产物/日志** | `list_artifacts` / `get_log` | F/G. 产物/诊断 |

> 注：v0.3.x 的 `analyze_repo` 已移除；本地构建域收敛为单一 `repo_build`（2.16），编译过程由模型自决（repo-analyzer.md §4）。

### 6.2 工作流一：完整构建生命周期（G1）

```
repo_build → list_projects → create_job → run_job → wait_build → list_artifacts
```

| 阶段 | 工具 | 说明 |
|------|------|------|
| ① 本地构建 | `repo_build`（单工具，模型自决编译过程） | 探测仓库类型→编译指导→执行→产物→自动留档 |
| ② 云上执行 | list_projects→create_job→run_job | 在 CodeArtsBuild 创建任务并触发 |
| ③ 状态监控 | wait_build | 轮询至终态 |
| ④ 产物获取 | list_artifacts | 返回下载+页面双链接 |

### 6.3 工作流二：构建失败诊断（G2）

```
wait_build(FAILED) → get_record(取 record_id) → get_log(仅error时)
    → 日志清洗(log-cleaner) → LLM 分析根因 → 修复 → 重试 | 升级用户
```

| 阶段 | 工具 | 说明 |
|------|------|------|
| ① 定位 | get_record | 取 record_id |
| ② 拉日志 | get_log | 仅失败/显式要求时；大日志截断 |
| ③ 清洗 | log-cleaner（内置） | 结构化 + error_type + error_code |
| ④ 分析 | LLM | 根因分析，给修复建议 |
| ⑤ 闭环 | repo_build（本地）或升级用户 | 修复后重试，或交互升级 |

### 6.4 工作流三：交互升级（异常）

```
repo_build(FAILED, 返回结构化错误) → 模型自决修复(通用 bash 装依赖/修正命令后重调 repo_build, 限1轮)
    → 解决 → 重试 repo_build
    → 无果 → 通知用户(异常类型+已尝试+选项) → 用户解决 → 继续 | 中止(留档由 repo_build 自动完成)
```

### 6.5 工作流四：日常查询

| 用户意图 | 调用序列 |
|----------|----------|
| 查看构建状态 | `get_status`（或 `wait_build`） |
| 查询历史与产物 | `list_records` → `get_record` → `list_artifacts` |
| 指定分支构建 | `run_job`(parameters=[{codeBranch, develop}]) → `wait_build` → `list_artifacts` |

### 6.6 编排实现

- **dsh 注册**：16 个原子工具均经 `ctx.tools.register(defineTool({...}))` 注册（schemastery schema）
- **LLM 编排（主）**：`skills/codeartsbuild/SKILL.md` 定义调用序列与规约，LLM 按需组合原子工具
- **本地构建已收敛**：`repo_build` 单工具封装探测/指导/执行/产物/留档，无需额外组合层

---

## 7. 与架构文档一致性核对

| 架构条目 | 契约落实 | 状态 |
|----------|----------|------|
| G1 自动创建并执行 | 工作流一（§6.2）：repo_build→...→list_artifacts | ✅ |
| G2 异常诊断 | 工作流二（§6.3）：get_log→清洗→LLM | ✅ |
| G3 产物双链接 | 工具 `list_artifacts` `download_url` + `console_url` | ✅ |
| G5 dsh 插件为主 | 16 个原子工具经 dsh `defineTool` 注册；LLM 编排（§6.6） | ✅ |
| B. 代码仓构建（repo-analyzer v0.2） | 工具 2.16 `repo_build`（本地构建域 1 工具，模型自决） | ✅ |
| KooCLI 实测操作名 | 云侧工具映射 `ShowRelatedProject`/`CreateNewJob`/`ExecuteJob`/`ShowJobBuildRecordDetail`/`DownloadBuildFullLog`（v1）；`ShowNewOutput`（v1，KooCLI 未封装，手动调用） | ✅（已实测/评审确认） |
| 禁用 v3 旧版接口 | §1.4.1 禁用清单 + §1.4.3 白名单（v3 全部禁用，产物改 v1 `ShowNewOutput`） | ✅ |
| 人工评审补充说明与接口调整（2026-09-17） | 各工具新增 `description`；`get_record`→`ShowJobBuildRecordDetail`、`list_artifacts`→`ShowNewOutput`（KooCLI 未封装手动调用）、`list_templates`→`ListOfficialTemplate`、`get_log`→`DownloadBuildFullLog`；`stop_job`/`get_status` 补充 buildNo | ✅（v0.4.3） |
| 状态枚举修订 | §4 去除 INITIALIZING/ABORTED | ✅ |
| 日志仅 error 获取 | 工具 `get_log` 调用约束 | ✅ |

## 8. 待人工确认项

| # | 项 | 说明 |
|---|----|------|
| 1 | `record_id` 来源 | `get_record` 已实测（`ShowJobBuildRecordDetail` 返回 `build_record_id`/`execution_id`/`devcloud_project_id`）；`get_log` 用 `build_record_id` 作为 recordId 调 `DownloadBuildFullLog`，二者对应关系待实调用确认 |
| 2 | `ShowNewOutput`(v1) 响应字段 | 产物 `package_info` / `image_info` / `obs_info` 的实际字段名与结构需实调用确认；KooCLI 未封装该接口，需手动调用（如 `cdo api`） |
| 3 | `ShowJobStepStatus`(v1) 响应字段 | status/result/build_no 实际字段名需实调用确认 |
| 4 | `ExecuteJob` 分支指定 | 已实测 scm 仅 build_commit_id/build_tag；分支经 parameters 传递，需确认任务参数约定名 |
| 5 | `ListRecords`(v1) 参数 | path 参数为 `build_project_id`；是否含 limit/offset 分页参数需实调用确认 |
| 6 | `DeleteTheJob`/`StopTheJob`(v1) 参数 | v1 版本是否仍需 build_no 等附加参数需实调用确认（`stop_job` 已按评审要求补 buildNo 入参） |
| 7 | `get_status` 接口待定 | 当前 `ShowJobStepStatus` 返回各子步骤状态较难解析；**待定**替换为其他接口（如 `ShowJobBuildRecordDetail`/`ShowRunningStatus`） |
