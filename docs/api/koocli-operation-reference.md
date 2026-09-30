# 参考资料 — KooCLI CodeArtsBuild 操作列表（实测归档）

> **文档编号**: CAB-REF-001
> **类型**: 参考资料（KooCLI 已不用于承载，仅作为 HTTP 实现的接口名 ↔ URL 对照历史归档）
> **日期**: 2026-09-16 实测（v7.2.12）
> **用途**: 自建 HTTP 承载（AK/SK 签名）后续实现的接口标识参考资料——契约中「KooCLI 操作」列保留为操作名 ↔ URL 的映射关系，与承载方式无关。
> **来源**: 原 `docs/architecture/architecture.md` §4.8/§4.9（2026-09-20 拆分为参考资料）

> ⚠️ **KooCLI 不再用于承载**（FE-05 决策：自建 HTTP + AK/SK 签名）。本表为实测历史归档：操作名、Method、参数、URL 均来自 KooCLI 实测，HTTP 实现直接按 URL 构造请求。

## 1. 核心操作列表（v1 推荐）

环境：KooCLI v7.2.12，`hcloud CodeArtsBuild --help` 实测。服务名 `CodeArtsBuild`。

**与构建生命周期相关的核心操作**（已实测参数；⭐ = 推荐接口 v1，v3/v4 一律禁用）：

| 场景 | KooCLI 操作 | 版本 | Method | 关键参数（必填加粗） |
|------|-------------|------|--------|----------------------|
| 项目感知 | ⭐ `ShowRelatedProject` | v1 | GET | 无（仅 --cli-region） |
| 任务列表 | ⭐ `ListJob` | v1 | GET | page_index?, page_size?, search?, build_status? |
| 项目任务列表 | ⭐ `ListProjectJobs` | v1 | GET | **project_id** |
| 任务详情 | ⭐ `ShowJobConfig` | v1 | GET | **job_id** |
| 创建任务 | ⭐ `CreateNewJob` | v1 | POST | **arch**, **job_name**, **project_id**, **steps.[N].module_id**, **steps.[N].name**, scms.[N].*, parameters.[N].* |
| 更新任务 | ⭐ `UpdateNewJob` | v1 | POST | **job_id**, 与 create 同构 |
| 删除任务 | ⭐ `DeleteTheJob` | v1 | DELETE | **job_id**（path） |
| 执行构建 | ⭐ `ExecuteJob` | v1 | POST | **job_id**, parameter.[N].{name,value}?, scm.{build_commit_id, build_tag, branch}? |
| 停止构建 | ⭐ `StopTheJob` | v1 | POST | **job_id**（path）, body={build_no} |
| 运行状态 | ⭐ `ShowJobBuildRecordDetail` | v1 | GET | **job_id**, **build_no**（path）；返回单值 `result.status`（STARTED/SUCCESS/FAILED，2026-09-18 评审落定为 get_status 接口）；`ShowJobStepStatus`（v1）保留供 wait_build 轮询 |
| 是否在构建 | ⭐ `ShowRunningStatus` | v1 | GET | **job_id** |
| 历史列表 | ⭐ `ListRecords` | v1 | GET | **build_project_id**, page?, limit? |
| 记录详情 | ⭐ `ShowJobBuildRecordDetail` | v1 | GET | **job_id**, **build_no** |
| 简要信息 | ⭐ `ListBriefRecord` | v1 | POST | **limit**, body=job_id 数组 |
| 构建产物 | ⭐ `ShowNewOutput` | v1 | GET | **job_id**, **build_no**（KooCLI 未封装，自建 HTTP 承载实现） |
| 全量日志 | ⭐ `DownloadBuildFullLog` | v1 | GET | **record_id**, log_level?(INFO\|DEBUG) |
| 实时日志 | ⭐ `DownloadBuildRealTimeLog` | v1 | GET | **job_id**, **build_no** |
| 任务模板 | ⭐ `ListOfficialTemplate` | v1 | GET | name?, page?, page_size? |
| 成功率 | ⭐ `ShowJobBuildSuccessRatio` | v1 | GET | 参数需实测 |

**v3 旧版接口（禁用）**：`CreateBuildJob`、`RunJob`、`UpdateBuildJob`、`DeleteBuildJob`、`StopJob`、`StopBuildJob`、`ListJobConfig`、`ShowJobStatus`、`ShowListHistory`、`ShowLastHistory`、`ShowListPeriodHistory`、`ShowHistoryDetails`、`ShowRecordInfo`、`ShowOutputInfo`、`ShowJobListByProjectId`、`ListBuildInfoRecord`、`ShowJobSuccessRatio`、`DownloadLogByRecordId`、`DownloadRealTimeLog`、`ListNotice`、`ListTemplates`。

> ⚠️ **接口禁用规则（评审决策）**：CodeArtsBuild **v3/v4 为旧版接口（一律禁用）**，**仅 v1 为推荐接口**。判定依据为 KooCLI 服务定义中的 `Request.Path`（如 `ExecuteJob`→`/v1/job/execute`、`RunJob`→`/v3/jobs/build`、`ShowRecordDetail`→`/v4/jobs/{id}/{no}/record-info`）。完整禁用清单见 `docs/api/api-contract.md` §1.4。

## 2. 完整操作列表（实测分类）

2026-09-16 KooCLI v7.2.12 实测（约 130 个操作），按功能域分类：

| 功能域 | 操作 |
|--------|------|
| **项目感知** | `ShowRelatedProject`、`ListRelatedProjectInfo`、`ShowProjectPermission`、`ShowDefaultProjectPermission`、`ApplyProjectPermission`、`ShowProjectJobPermission` |
| **任务 CRUD** | `CreateNewJob`、`CreateBuildJob`、`UpdateNewJob`、`UpdateBuildJob`、`DeleteBuildJob`、`DeleteTheJob`、`CopyJob`、`BatchDeleteBuildJobs`、`ListJob`、`ListProjectJobs`、`ListJobConfig`、`ShowJobConfig`、`ShowJobConfigDiff`、`ShowJobInfo`、`ShowJobListByProjectId`、`ShowJobTotal`、`ShowCopyName` |
| **执行控制** | `ExecuteJob`、`RunJob`、`StopBuildJob`、`StopJob`、`StopTheJob`、`ShowJobStatus`、`ShowRunningStatus`、`ShowJobStepStatus`、`ShowBuildDetails` |
| **状态/历史** | `ShowListHistory`、`ShowListPeriodHistory`、`ShowLastHistory`、`ShowRecordDetail`、`ShowRecordInfo`、`ShowHistoryDetails`、`ShowBuildRecord`、`ListRecords`、`ListBriefRecord`、`ListBuildInfoRecord`、`ListBuildInfoRecordByJobId`、`ShowJobBuildRecordDetail`、`ShowJobBuildSuccessRatio`、`ShowJobSuccessRatio`、`ShowJobBuildTime` |
| **产物/日志** | `ShowOutputInfo`、`DownloadBuildLog`、`DownloadBuildFullLog`、`DownloadBuildRealTimeLog`、`DownloadRealTimeLog`、`DownloadTaskLog`、`DownloadLogByRecordId`、`ShowBuildRecordBuildScript`、`ShowBuildRecordFlowGraph`、`ShowBuildRecordFullStages`、`ShowFlowGraph` |
| **模板** | `ListCustomTemplate`、`ListOfficialTemplate`、`ListRecommendOfficialTemplate`、`ListTemplates`、`ShowTemplate`、`ShowYamlTemplate`、`ShowDockerfileTemplate`、`ShowImageTemplateList`、`CreateTemplate`、`CreateTemplates`、`UpdateBuildJob`、`DeleteTemplate`、`DeleteTemplates`、`AddFavouriteCustomTemplate`、`AddFavouriteOfficialTemplate`、`RemoverFavouriteCustomTemplate`、`RemoverFavouriteOfficialTemplate`、`SaveTemplateUsedInfo` |
| **参数/密钥** | `ListBuildParameter`、`ShowBuildParamsList`、`ShowDefaultBuildParameters`、`ShowJobSystemParameters`、`UploadKeystore`、`DownloadKeystore`、`DownloadKeystoreByName`、`ListKeystore`、`ListKeystoreSearch`、`UpdateKeystore`、`DeleteKeystore`、`AddKeystorePermission`、`UpdateKeystorePermission`、`DeleteKeystorePermission`、`ShowKeystorePermission` |
| **通知/权限/其他** | `ShowJobNoticeConfigInfo`、`ListNotice`、`UpdateNotice`、`UpdateNewNoticeNew`、`DisableNotice`、`ShowJobRolePermission`、`ShowJobPipelineInfo`、`ShowDomainStatus`、`ShowDomainsStatuses`、`ShowUserChargeType`、`ShowUserOverPackageQuota`、`CheckJobNameIsExists`、`CheckJobInternal`、`CheckJobCountIsTopLimit`、`CheckWebhookUrl`、`ClearRecyclingJobs`、`ListRecyclingJob`、`RestoreRecyclingJobs`、`DeleteRecyclingJobs`、`SetKeepTime`、`ShowActionIInfo`、`ShowAvailableInnerSpec`、`ShowReportSummary`、`ShowSummaryBuildJobInfo`、`ShowPackageSpecCountDown`、`ListEndPoints`、`ListGroupTree`、`CreateJobGroup`、`UpdateJobGroup`、`DeleteGroup`、`MoveGroup`、`BatchUpdateJobRolePermission`、`ListJunitCoverageSummary`、`DownloadJunitCoverageZip`、`ShowDisable`、`DisableBuildJob`、`EnableBuildJob`、`DisableTheJob`、`SwitchedPacket`、`ListUpdateJobHistory`、`ListRepository`、`ListRepoBranch` |

> 完整操作名列表可由 `hcloud CodeArtsBuild --help` 实时获取。
>
> ⚠️ **本表为全量实测分类**（含 v3/v4 禁用接口，如 `ShowRecordInfo`/`ShowRecordDetail`/`DownloadBuildLog`/`DownloadTaskLog`）；**实际使用以核心操作表（⭐ v1）与 api-contract.md §1.4 为准**。

## 3. 版本体系判定依据

**CodeArtsBuild 接口版本体系**：**v1 为新接口（唯一推荐使用），v3/v4 为旧版接口（一律禁止使用）**。

判定依据：KooCLI 缓存服务定义（`~/.hcloud/metaRepo/template/codeartsbuild/*.yaml`）中 `Request.Path` 字段实测。示例：
- `ExecuteJob` → `/v1/job/execute`（唯一推荐）
- `RunJob` → `/v3/jobs/build`（旧，禁用）
- `ShowRecordDetail` → `/v4/jobs/{job_id}/{build_no}/record-info`（旧，禁用）
- `ShowRecordInfo` → `/v3/jobs/{job_id}/{build_no}/record-info`（旧，待下线，禁用）
