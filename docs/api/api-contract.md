# CodeArtsBuild 插件 — 工具接口契约

> **文档编号**: CAB-CONTRACT-001  
> **版本**: v0.6.0（迭代由用户决定）  
> **日期**: 2026-09-20  
> **状态**: 待评审  
> **前置依赖**: 架构设计（`docs/architecture/architecture.md`）  
> **工具契约拆分**：各工具详细契约见 `docs/api/tools/*.md`（§2.0 索引）

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-15 | 初始契约草案（16 个工具） |
| v0.2.0 | 2026-09-16 | **契约人工确定**：KooCLI v7.2.12 实测对齐；状态枚举去除 INITIALIZING/ABORTED；新增 §1.4 接口禁用规则（v3 旧版禁用）；各工具补充实测 URL |
| v0.4.0 | 2026-09-16 ~ 09-18 | **工具全景与细节落地**：移除旧版 analyze_repo、本地构建域收敛为 `repo_build`、统一命名规约（§1.2.1）；各工具补 description/接口调整（get_record→ShowJobBuildRecordDetail、list_artifacts→ShowNewOutput、get_log→DownloadBuildFullLog 等）；wait_build 轮询策略、recommended_steps 映射、产物统一结构体；openapi.yaml 输入输出对齐；KooCLI 实调用确认（record_id 对应/ListRecords UUID/ExecuteJob 分支/HTTP 方法/状态枚举冲突） |
| v0.5.0 | 2026-09-18 | **模板化组装 + v4 禁用**：create_job 增 stepsPlan 意图级入参（language 降速选、steps 原样透传）；禁用规则扩至 v3/v4 一律禁用（仅 v1）；get_status 落定 `ShowJobBuildRecordDetail` |
| v0.6.0 | 2026-09-20 | **承载反转（SDK → 自建 HTTP）**：§1.2 通用约定改为「自建 HTTP 承载 + AK/SK 签名」；各工具 KooCLI 操作列标注「承载无关，仅作接口标识」；ShowNewOutput 同构实现（不再需 token） |

---

## 1. 总则

### 1.1 契约目的

本文档是全部工具的唯一事实来源。**实现必须与本文档一致**；不一致视为缺陷。

### 1.2 通用约定

- **传输**：dsh 插件（唯一终端形态）原生注册工具，共用同一契约
- **华为云调用**：所有工具底层经**自建 HTTP 客户端**承载（`fetch` + `AKSKSigner` AK/SK 签名，见 `src/infra/http-client.ts`）；HTTP method/URL 以各工具文档（§2.0 索引）标注为准
- **错误返回**：所有工具失败统一返回错误格式（见 §3）
- **字段命名**：JSON 输出使用 camelCase（与工具调用惯例一致），底层原始输出中的 snake_case 字段经适配层转换

> **承载演进注记**：契约中的「KooCLI 操作」列保留为**接口标识**（操作名 ↔ URL 的映射关系，2026-09-16 KooCLI 实测所得），与承载方式无关——自建 HTTP 直接按 URL 构造请求。

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

### 1.3 接口实测说明

**来源**：2026-09-16 KooCLI v7.2.12 实测（`hcloud CodeArtsBuild --help` + `~/.hcloud/metaRepo/template/codeartsbuild/*.yaml` 的 `Request.Path`/`Request.Medthod`）+ 2026-09-18 openapi.yaml 对齐 + KooCLI 实调用确认。

已实测确认的操作、URL、参数见各工具文档（§2.0 索引）。`record_id` 获取路径见 `get_record` / `get_log` 文档。承载方式（KooCLI / SDK / 自建 HTTP）不影响 URL 与参数定义，实现以 URL 直接构造请求。

### 1.4 接口禁用规则（过时 / 待下线 / 旧版）

> **评审决策**：禁止使用过时、编译构建(待下线)、编译构建(旧)相关的接口。KooCLI 操作列表中大量功能重叠的操作需甄别，仅使用**推荐接口**。

#### 1.4.0 版本体系判定（2026-09-16 实测 Path 确认；2026-09-18 v4 加入禁用）

**CodeArtsBuild 接口版本体系**：**v1 为新接口（唯一推荐使用），v3/v4 为旧版接口（一律禁止使用）**。

> 判定依据：KooCLI 缓存服务定义（`~/.hcloud/metaRepo/template/codeartsbuild/*.yaml`）中 `Request.Path` 字段实测。示例：
> - `ExecuteJob` → `/v1/job/execute`（唯一推荐）
> - `RunJob` → `/v3/jobs/build`（旧，禁用）
> - `ShowRecordDetail` → `/v4/jobs/{job_id}/{build_no}/record-info`（旧，禁用）
> - `ShowRecordInfo` → `/v3/jobs/{job_id}/{build_no}/record-info`（旧，待下线，禁用）

#### 1.4.1 v3/v4 旧版接口（禁用）

以下接口 Path 为 `/v3/...` 或 `/v4/...`，属**编译构建旧版接口**，**一律禁止使用**：

| 禁用接口 | Path（实测） | 推荐替代（v1） |
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
| `ShowHistoryDetails` | `/v3/jobs/{id}/{no}/history-details` | `ShowJobBuildRecordDetail`（`/v1/record/{id}/{no}/record-info`） |
| `ShowRecordInfo` | `/v3/jobs/{id}/{no}/record-info` | `ShowJobBuildRecordDetail`（`/v1/record/{id}/{no}/record-info`） |
| `ShowRecordDetail` | `/v4/jobs/{id}/{no}/record-info` | `ShowJobBuildRecordDetail`（`/v1/record/{id}/{no}/record-info`） |
| `DownloadBuildLog` | `/v4/{record_id}/download-log` | `DownloadBuildFullLog`（`/v1/log/{record_id}/download-log`） |
| `DownloadTaskLog` | `/v4/{record_id}/task-log` | `DownloadBuildFullLog`（`/v1/log/{record_id}/download-log`） |
| `ShowOutputInfo` | `/v3/jobs/{id}/{no}/output-info` | 产物：`ShowNewOutput`（`/v1/job/{id}/{no}/output`，KooCLI 未封装，自建 HTTP 承载实现） |
| `ShowJobListByProjectId` | `/v3/{project_id}/jobs` | `ListProjectJobs`（`/v1/job/{project_id}/list`） |
| `ListBuildInfoRecord` | `/v3/jobs/{id}/build-info-records` | `ListBuildInfoRecordByJobId`（`/v1/record/{id}/list`） |
| `ShowJobSuccessRatio` | `/v3/jobs/{id}/success-ratio` | `ShowJobBuildSuccessRatio`（`/v1/report/ratio`） |
| `DownloadLogByRecordId` | `/v3/{record_id}/download-log` | `DownloadBuildFullLog`（`/v1/log/{record_id}/download-log`） |
| `DownloadRealTimeLog` | `/v3/jobs/{id}/{no}/real-time-log` | `DownloadBuildRealTimeLog`（`/v1/log/{id}/{no}/real-time-log`） |
| `ListNotice` | `/v3/jobs/notice/{id}/query` | `ShowJobNoticeConfigInfo`（`/v1/job/{id}/notice`） |
| `ListTemplates` | `/v3/templates/query` | `ListCustomTemplate`（`/v1/template/custom`）/ `ListOfficialTemplate`（`/v1/template/officialtemplates`） |

#### 1.4.2 v1 新接口（优先使用）

以下接口 Path 为 `/v1/...`，属**新接口**，**唯一推荐使用**（v4 接口 `ShowRecordDetail`/`DownloadBuildLog`/`DownloadTaskLog` 已随 v3 一并禁用，见 §1.4.1）：

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
ShowNewOutput (/v1/job/{id}/{no}/output，KooCLI 未封装，自建 HTTP 承载实现)
```

> 判定原则：**v3/v4 Path 一律禁用**；仅 v1 推荐使用；新增工具映射前须按 `hcloud` 服务定义核对 Path 版本。

> ⚠️ 注意：`DownloadBuildFullLog`(v1) 与 `DownloadBuildLog`(v4，禁用) 均为「下载全量构建日志」，**评审决策（2026-09-17）：`get_log` 使用 `DownloadBuildFullLog`（v1 `/v1/log/{record_id}/download-log`）**；`DownloadBuildRealTimeLog`(v1) 为实时日志。

---

## 2. 工具契约

> 各工具详细契约（输入/输出/字段映射/实测确认）已拆分为独立文档：`docs/api/tools/*.md`。以下为速查索引。

### 2.0 工具速查表（18 个）

**本地构建域（B. 代码仓构建）**

| # | 工具名称 | 定义 | 使用场景 | 契约详情 |
|---|----------|------|----------|----------|
| 2.16 | `codeartsbuild_repo_build` | 本地构建（唯一）：探测仓库类型→编译指导→执行编译→产物收集→留档 内置 | AI 自主编译代码仓；编译过程由模型自行判断 | [repo_build.md](tools/repo_build.md) |
| 2.17 | `codeartsbuild_repo_prepare` | 本地仓库准备 CodeArtsRepo 仓库（检测远端→建仓+回读 RepoInfo），返回远程 URL + 推送指引；**实际 push 由 repo_push 接手** | 本地仓库无远端时建仓并取得 RepoInfo，打通 create_job 前置 | [repo_prepare.md](tools/repo_prepare.md) |
| 2.18 | `codeartsbuild_repo_push` | 推送本地仓库代码到 CodeArtsRepo（内置一次智能尝试：代理+SSL 自动携带、origin 项目归属预检、**缺 remoteUrl 自动探测本地 codehub 远端**、失败 stderr 分类输出 next_actions） | repo_prepare 建仓后推送代码；复杂凭据/崩溃交模型/用户接管 | [repo_push.md](tools/repo_push.md) |

**云侧·项目感知（A）**

| # | 工具名称 | 定义 | 使用场景 | 契约详情 |
|---|----------|------|----------|----------|
| 2.1 | `codeartsbuild_list_projects` | 项目列表（v1 `ShowRelatedProject`） | 创建任务前选择 projectId | [list_projects.md](tools/list_projects.md) |
| 2.2 | `codeartsbuild_list_jobs` | 任务列表（v1 `ListJob`） | 查看/搜索已有任务 | [list_jobs.md](tools/list_jobs.md) |
| 2.3 | `codeartsbuild_get_job` | 任务详情（v1 `ShowJobConfig`） | 查看/评估任务配置 | [get_job.md](tools/get_job.md) |

**云侧·任务编排（C）**

| # | 工具名称 | 定义 | 使用场景 | 契约详情 |
|---|----------|------|----------|----------|
| 2.4 | `codeartsbuild_create_job` | 创建任务（v1 `CreateNewJob`） | 本地构建配置落到云端 | [create_job.md](tools/create_job.md) |
| 2.5 | `codeartsbuild_update_job` | 更新任务（v1 `UpdateNewJob`） | 修改任务配置 | [update_job.md](tools/update_job.md) |
| 2.6 | `codeartsbuild_delete_job` | 删除任务（v1 `DeleteTheJob`），不可逆 | 废弃任务清理（须确认） | [delete_job.md](tools/delete_job.md) |
| 2.13 | `codeartsbuild_list_templates` | 用户自定义模板列表（v1 `ListCustomTemplate`） | create_job 前检查可用的用户自建模板 | [list_templates.md](tools/list_templates.md) |

**云侧·执行控制（D）**

| # | 工具名称 | 定义 | 使用场景 | 契约详情 |
|---|----------|------|----------|----------|
| 2.7 | `codeartsbuild_run_job` | 触发构建（v1 `ExecuteJob`） | 启动云端构建，返回 build_number | [run_job.md](tools/run_job.md) |
| 2.8 | `codeartsbuild_stop_job` | 停止构建（v1 `StopTheJob`） | 误触发/超时终止 | [stop_job.md](tools/stop_job.md) |

**云侧·状态监控（E）**

| # | 工具名称 | 定义 | 使用场景 | 契约详情 |
|---|----------|------|----------|----------|
| 2.9 | `codeartsbuild_get_status` | 状态查询（v1 `ShowJobBuildRecordDetail`） | 快速查看当前状态 | [get_status.md](tools/get_status.md) |
| 2.10 | `codeartsbuild_list_records` | 历史列表（v1 `ListRecords`） | 查看历史记录 | [list_records.md](tools/list_records.md) |
| 2.11 | `codeartsbuild_get_record` | 记录详情（v1 `ShowJobBuildRecordDetail`），含 build_record_id/execution_id/devcloud_project_id | 失败定位；取记录 ID 供日志下载 | [get_record.md](tools/get_record.md) |
| 2.14 | `codeartsbuild_wait_build` | 等待终态（轮询 `ShowJobStepStatus`） | 阻塞等待构建完成 | [wait_build.md](tools/wait_build.md) |

**云侧·产物/日志（F/G）**

| # | 工具名称 | 定义 | 使用场景 | 契约详情 |
|---|----------|------|----------|----------|
| 2.12 | `codeartsbuild_list_artifacts` | 产物清单（v1 `ShowNewOutput`，自建 HTTP 承载），软件包/镜像两类 | 交付构建结果 | [list_artifacts.md](tools/list_artifacts.md) |
| 2.15 | `codeartsbuild_get_log` | 日志拉取+清洗（v1 `DownloadBuildFullLog`，ZIP 解压） | 仅失败/显式要求时；供 LLM 分析 | [get_log.md](tools/get_log.md) |

---

## 3. 错误契约

### 3.1 错误返回格式（统一）

```json
{
  "content": [{ "type": "text", "text": "错误描述（含错误码与详情）" }],
  "isError": true
}
```

**text 规范**：`[错误码] 人类可读描述\n详情: <HTTP/API 返回详情>`

### 3.2 错误码表

| 错误码 | 含义 | 典型触发 | 建议处理 |
|--------|------|----------|----------|
| `E_CONFIG` | 配置缺失/非法 | 凭据未配置（env 缺 CAB_AK/SK 或 hcloud config 不可读）、region 无 endpoint | 配置凭据（见 auth.md §2） |
| `E_AUTH` | 认证失败 | AK/SK 失效（401）、无权限（403） | 检查 AK/SK 与权限；hcloud config 密文时改用环境变量 |
| `E_PARAM` | 参数校验失败 | 必填缺失、类型错误、module_id 非白名单 | 返回字段级错误列表 |
| `E_API` | CodeArtsBuild 业务错误 | 任务不存在、重名、无权限 | 透传 HTTP 响应 error_code/error_msg |

> **create_job 重名（实测 2026-10-10）**：项目下任务名已存在 → HTTP 422 `DEVCB.00031075 项目下任务名称已存在`。创建任务前先用 `list_jobs(search=拟用任务名)` 查重；有同名任务 → 复用/改名（`-v2` 等后缀）或 `update_job` 修改已有任务，不重复新建（SKILL 强制规约 #10）。
| `E_NETWORK` | 网络异常 | 超时、连接失败 | 幂等命令重试 ≤3 次 |
| `E_TIMEOUT` | 构建等待超时 | wait_build 超时 | 返回当前状态 |
| `E_LOG` | 日志处理错误 | 日志过大、下载失败 | 返回 console_url |

---

## 4. 状态枚举（2026-09-18 实调用确认修订）

### 4.1 构建状态（status）

**统一状态枚举（工具层规范化输出）**：

| 值 | 阶段 | 说明 |
|----|------|------|
| `QUEUED` | 排队 | 已提交待执行 |
| `RUNNING` | 运行中 | 正在执行构建步骤 |
| `SUCCESS` | 终态 | 构建成功 |
| `FAILED` | 终态 | 构建失败（触发 G2 诊断） |
| `ERROR` | 终态 | 构建异常 |
| `CANCELED` | 终态 | 用户取消 |
| `COMPLETED` | 终态 | 已完成 |

> **修订说明（2026-09-18 实调用确认；2026-09-21 Layer 2 实调补正）**：实测接口返回状态与 openapi/早期设计有差异，工具层需在适配层**映射为上述统一枚举**。原始接口状态映射表：

| 接口 | 原始状态（实测） | 映射 |
|------|-----------------|------|
| `ShowJobStepStatus` | `result.workflow.status`：`running` / `completed` / `queued` / `aborted` | running→RUNNING、queued→QUEUED、completed→SUCCESS/FAILED/CANCELED（结合 workflow.error，见下）、aborted→CANCELED |
| `ShowJobStepStatus`（2026-09-21 补） | `completed` + `workflow.error` | error 为**取消类**（code/reason 含 取消/abort/cancel，实测 `COCT.0020003.450` "用户取消任务执行"）→ **CANCELED**；error 其他 → FAILED；error=null → SUCCESS |
| `ListRecords` | `data[].status`：`STARTED` / `ABORTED` / `SUCCESS` / `FAILED` / `ERROR` 等 | STARTED→RUNNING、ABORTED→CANCELED、其余直映 |
| `ShowJobBuildRecordDetail` | `result.status`：`STARTED` / `SCHEDULING` / `SUCCESS` / `FAILED` / `ABORTED` 等 | STARTED→RUNNING、**SCHEDULING→QUEUED**（2026-09-21 实调发现排队态）、ABORTED→CANCELED、其余直映 |
| `ShowRunningStatus` | `last_build_status`：`Running` / `Finished` + `is_running`（**仅 job 最新一次构建，无 build_no 参数，不能按指定构建查询**） | Running→RUNNING；Finished+is_running=false→查终态（get_record/list_records） |
| `ListJob` | `last_build_status`：`red` / `blue` / `aborted` / `InQueue` / `building` / `none`（openapi 枚举）；`last_job_running_status`：`Running`/`Finished` | red→FAILED、blue→SUCCESS、aborted→CANCELED、InQueue→QUEUED、building→RUNNING、none→未知；Running→RUNNING、Finished→已终态 |

### 4.2 终态判定集合

```
{ SUCCESS, FAILED, ERROR, CANCELED, COMPLETED }
```

> **wait_build 终态判定**：以 `ShowJobStepStatus` 映射后为准（§4.1 映射表）；`ShowRunningStatus` 仅查最新构建，**不能替代按 build_no 的 get_status**。
>
> **状态口径（2026-10-10 修订）**：`ShowJobStepStatus` 与 `ShowJobBuildRecordDetail` 是**两个数据源，可能不同步**（实测：wait_build 报 SUCCESS 而 get_status 报 FAILURE）。**`record-info`（ShowJobBuildRecordDetail result.status）为权威终态**——wait_build 遇到 `completed` 一律复核 record-info（不再只复核 completed+error 场景），避免口径矛盾（FE-11 §6.2）。

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

### 6.1 工具注册全景（18 个原子工具）

| 域 | 工具 | 场景 |
|----|------|------|
| **本地构建域** | `repo_build`（探测+编译指导+执行+产物+留档 内置） | B. 代码仓构建 |
| **仓库准备** | `repo_prepare`（本地仓库准备 CodeArtsRepo 仓库：检测远端→建仓+回读 RepoInfo） | B. 代码仓构建（create_job 前置） |
| **仓库推送** | `repo_push`（本地仓库推送代码到 CodeArtsRepo：一次智能尝试 + 失败分类） | B. 代码仓构建（repo_prepare 后接续） |
| **云侧·项目感知** | `list_projects` / `list_jobs` / `get_job` | A. 项目感知 |
| **云侧·任务编排** | `create_job` / `update_job` / `delete_job` / `list_templates` | C. 任务编排 |
| **云侧·执行控制** | `run_job` / `stop_job` | D. 执行控制 |
| **云侧·状态监控** | `get_status` / `list_records` / `get_record` / `wait_build` | E. 状态监控 |
| **云侧·产物/日志** | `list_artifacts` / `get_log` | F/G. 产物/诊断 |

> 注：v0.3.x 的 `analyze_repo` 已移除；本地构建域为 `repo_build`（2.16）+ `repo_prepare`（2.17）+ `repo_push`（2.18，FE-08 §5 形态 B，2026-10-10：独立推送工具内置一次智能尝试——代理/SSL 自动携带、origin 项目归属预检、失败 stderr 分类；复杂凭据/Windows 崩溃交模型/用户），编译过程由模型自决（FE-01-本地代码仓构建流程设计-20260919.md §4）。

### 6.2 工作流一：完整构建生命周期（G1）

```
repo_build → create_job → run_job → wait_build → list_artifacts
```

> `projectId` 由用户提供或取会话上下文（架构 §4.3），无需 `list_projects` 步骤（`list_projects` 仅作查看辅助/首次选择）。

| 阶段 | 工具 | 说明 |
|------|------|------|
| ① 本地构建 | `repo_build`（单工具，模型自决编译过程） | 探测仓库类型→编译指导→执行→产物→自动留档 |
| ② 云上执行 | create_job→run_job | 在 CodeArtsBuild 创建任务并触发 |
| ③ 状态监控 | wait_build | 轮询至终态 |
| ④ 产物获取 | list_artifacts | 返回 console_url 页面跳转链接（当前版本不提供下载） |

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

- **dsh 注册**：18 个原子工具均经 `ctx.tools.register(defineTool({...}))` 注册（schemastery schema）
- **LLM 编排（主）**：`skills/codeartsbuild/SKILL.md` 定义调用序列与规约，LLM 按需组合原子工具
- **本地构建已收敛**：`repo_build` 单工具封装探测/指导/执行/产物/留档，无需额外组合层

---

## 7. 与架构文档一致性核对

| 架构条目 | 契约落实 | 状态 |
|----------|----------|------|
| G1 自动创建并执行 | 工作流一（§6.2）：repo_build→...→list_artifacts | ✅ |
| G2 异常诊断 | 工作流二（§6.3）：get_log→清洗→LLM | ✅ |
| G3 产物链接 | 工具 `list_artifacts` 返回 `console_url` 页面跳转链接（当前版本不提供下载） | ✅ |
| G5 dsh 插件为主 | 18 个原子工具经 dsh `defineTool` 注册；LLM 编排（§6.6） | ✅ |
| B. 代码仓构建（repo-analyzer v0.2） | 工具 2.16 `repo_build`（本地构建域 1 工具，模型自决） | ✅ |
| KooCLI 实测操作名 | 云侧工具映射 `ShowRelatedProject`/`CreateNewJob`/`ExecuteJob`/`ShowJobBuildRecordDetail`/`DownloadBuildFullLog`（v1）；`ShowNewOutput`（v1，自建 HTTP 承载统一实现） | ✅（已实测/评审确认） |
| 禁用 v3 旧版接口 | §1.4.1 禁用清单（v3/v4 全部禁用，产物改 v1 `ShowNewOutput`） | ✅ |
| 人工评审补充说明与接口调整（2026-09-17） | 各工具新增 `description`；`get_record`→`ShowJobBuildRecordDetail`、`list_artifacts`→`ShowNewOutput`、`get_log`→`DownloadBuildFullLog`；`stop_job`/`get_status` 补充 buildNo | ✅（v0.4.0） |
| list_templates 查询对象调整（2026-09-23 实调确认） | `list_templates` 改查**用户自定义模板** `ListCustomTemplate`（`/v1/template/custom`，参数/响应实测）；官方模板 `ListOfficialTemplate` 仅作 step-templates.json 离线初始化数据源 | ✅（v0.6.0 补充） |
| 状态枚举修订 | §4 去除 INITIALIZING/ABORTED | ✅ |
| 日志仅 error 获取 | 工具 `get_log` 调用约束 | ✅ |

---

## 8. 残留待人工确认项

> **已确认项（2026-09-18/21 实调用确认）**：record_id 来源、ShowNewOutput 字段、ShowJobStepStatus 字段、ExecuteJob 分支指定、ListRecords 参数（36 位 UUID）、DeleteTheJob/StopTheJob 参数、get_status 接口落定、状态枚举冲突、CreateNewJob steps 必填、DownloadBuildFullLog 返回 ZIP——均已确认并写入各工具文档，不再单列。

| # | 项 | 说明 | 状态 |
|---|----|------|------|
| 11 | **ListRecords 空数据观察** | ⚠️ **2026-09-21 Layer 2 实调发现**：用 build_project_id=`a5e151e2-...`（任务 `maven-build-20260818` 的 build_project_id）调 ListRecords 返回 `total=-1, records=[]`，而该任务确有构建记录——build_project_id 口径（= ListJob 返回的 build_project_id）可能不一致，待进一步确认（详见 list_records.md） | ⚠️ |
