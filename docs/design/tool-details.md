# CodeArtsBuild 插件 — 工具详细设计

> **文档编号**: CAB-DESIGN-003
> **版本**: v0.3.0（迭代由用户决定）
> **日期**: 2026-09-18
> **状态**: 待评审
> **上游依赖**: 架构设计（`docs/architecture/architecture.md`）、接口契约（`docs/api/api-contract.md`，**唯一事实来源**，已对齐 openapi.yaml + KooCLI 实调用确认）
> **配套详细设计**: `docs/design/repo-analyzer.md`（repo_build 内部流程）、`docs/design/log-cleaner.md`（get_log 日志清洗）、`docs/design/step-templates.md`（create_job step 模板库，官方模板拆解）
> **对齐依据**: `docs/example/openapi.yaml` + KooCLI v7.2.12 实调用（2026-09-18）+ 自建 HTTP 实调用（2026-09-20，19/19 通过）

## 0. 文档定位

本文档是 **16 个工具的详细设计层**，回答"每个工具**如何实现**"（handler 内部逻辑、校验规则、错误映射、边界处理），不重复契约已定义的"是什么"（入参/出参/URL 映射见 api-contract.md）。

**设计规约**：
- **简单接口从简**：入参单一、直通 HTTP 的工具，仅用一表 + 少量要点描述，不展开伪代码。
- **create_job 详尽**：参数组装、模板化、recommended_steps 映射、校验规则需完整设计。
- **一致性**：所有输入/输出/错误码/状态枚举与 api-contract.md 严格一致；不一致视为缺陷。
- **引用原则**：repo_build 内部流程见 repo-analyzer.md，get_log 清洗见 log-cleaner.md，本文不重复展开。

---

## 1. 设计总则（所有工具通用）

### 1.1 工具 handler 通用骨架

```typescript
async function handler(ctx: Context, input: Schema) {
  try {
    validate(input);                          // ① 参数校验（schemastery 已拦必填/类型，此处补业务校验）
    const result = await provider.operation(...);  // ② 调 Provider（云侧经 HttpClient / 本地直执行）
    return normalize(result);                 // ③ 输出规范化（snake_case → camelCase、统一结构体）
  } catch (e) {
    return mapError(e);                       // ④ 错误映射（§1.3），返回 isError 统一格式
  }
}
```

### 1.2 公共行为约定

| 项 | 规约 |
|----|------|
| **projectId 会话级注入** | `create_job`/`list_records` 的 projectId 缺省时自动取会话上下文（架构 §4.3 优先级：显式 > 会话 > 配置 > 询问）；显式传入覆盖并更新上下文 |
| **projectId 校验** | 会话 projectId 非法（删除/无权限）→ `E_API`，提示 LLM 走 `list_projects` 重选 |
| **buildNo 类型** | 入参为 number；API 返回可能为 string，适配层统一转 number |
| **承载** | 全部工具经 `HttpClient`（AK/SK 签名）调用，URL 见 api-contract.md §2（如 create_job → POST `/v1/job/create`） |
| **幂等请求重试** | 网络类错误（E_NETWORK）重试 ≤3 次（间隔 2s），仅限幂等请求（list_/get_/wait_ 查询类） |
| **输出命名** | camelCase（适配层转换 snake_case） |
| **错误返回** | 统一 `{content:[{type:"text", text:"[错误码] 描述\n详情:..."}], isError:true}`（契约 §3.1） |

### 1.3 错误映射表（公共）

| 异常来源 | 错误码 | 映射规则 |
|----------|--------|----------|
| 凭据未配置 / region 无 endpoint | `E_CONFIG` | 提示配置 CAB_AK/SK 或 hcloud config（auth.md） |
| AK/SK 失效、鉴权失败（401/403） | `E_AUTH` | 提示检查 AK/SK；403 区分业务权限（转 E_API） |
| 入参业务校验失败 | `E_PARAM` | 返回字段级错误列表 |
| HTTP 4xx/5xx 业务错误码（任务不存在、重名等） | `E_API` | 透传响应体 error_code/error_msg |
| 网络超时/连接失败 | `E_NETWORK` | 查询类请求重试 ≤3 次后报错 |
| wait_build 超时 | `E_TIMEOUT` | **非异常**：返回 `status=TIMEOUT` + last_status |
| 日志过大/下载失败 | `E_LOG` | 返回 console_url 提示控制台查看 |

---

## 2. 简单工具详细设计（14 个）

> 简单接口判定：入参 ≤3 个必填、handler 逻辑为"校验→直通 HTTP→规范化"、无状态、无内部多步编排。以下 14 个工具按此标准从简设计。

### 2.1 codeartsbuild_list_projects

| 项 | 设计 |
|----|------|
| **入参** | 无 |
| **handler** | 调 `ShowRelatedProject`（GET `/v1/domain/project/related`）→ 原样返回 |
| **规范化** | `result.project_info_list[].identifier` → projectId（原样保留字段名 `identifier`/`name`，输出顶层加 `total`） |
| **边界** | 空列表返回 `{total: 0, projects: []}`；凭据未配置 → E_CONFIG |
| **错误** | E_CONFIG / E_AUTH / E_API / E_NETWORK |

### 2.2 codeartsbuild_list_jobs

| 项 | 设计 |
|----|------|
| **入参** | pageIndex?, pageSize?, search?, buildStatus?, sortField?, sortOrder?, creatorId? |
| **handler** | 调 `ListJob`（GET `/v1/job/list`）→ 规范化 |
| **校验** | pageIndex 0~1e9；pageSize 1~100；search 空串视为未传；buildStatus ∈ {aborted, InQueue, building, red, blue, none}（openapi 枚举） |
| **规范化** | `result.job_list[].id` → jobId；输出 `{jobs, total}`（job_list→jobs）；last_build_time 毫秒时间戳→ISO |
| **边界** | 无项目维度参数（实测 ListJob 无 project_id）；需项目过滤时由模型用 search 或返回的 project_id 自行过滤 |
| **错误** | E_PARAM / E_CONFIG / E_AUTH / E_API / E_NETWORK |

### 2.3 codeartsbuild_get_job

| 项 | 设计 |
|----|------|
| **入参** | jobId（必填）、getAllParams?（query `get_all_params`，true/false） |
| **handler** | 调 `ShowJobConfig`（GET `/v1/job/{job_id}/config`）→ 规范化 |
| **校验** | jobId 非空、长度 ≤64 |
| **规范化** | 保留 `result` 主体（camelCase）；steps[].module_id 为全限定名（如 `devcloud2018.codeci_action_20043.action`）；scms[].scm_type 实测 `codehub` |
| **边界** | 任务不存在 → E_API（透传 HTTP error_code/error_msg） |
| **错误** | E_PARAM / E_API / E_CONFIG / E_AUTH / E_NETWORK |

### 2.4 codeartsbuild_update_job

| 项 | 设计 |
|----|------|
| **入参** | jobId（必填）、body（必填，与 create_job 同构的可修改配置片段，含 arch/projectId/jobName/steps 等） |
| **handler** | 调 `UpdateNewJob`（POST `/v1/job/update`）→ 规范化输出 `{job_id, updated: true}`（原始响应 `result.job_id`） |
| **校验** | **全量覆盖语义**：body 缺字段视为"清除原值"——模型必须先 `get_job` 取原配置，再修改后整体提交；禁止直接传局部片段 |
| **边界** | body 为空对象 → E_PARAM；jobId 不存在 → E_API |
| **注意** | 不改 jobId（jobId 在 body 外独立传参）；body 结构与 create_job 对齐（arch 枚举 x86-64/arm、steps module_id 全限定名、parameters 双层结构） |
| **错误** | E_PARAM / E_API / E_CONFIG / E_AUTH / E_NETWORK |

### 2.5 codeartsbuild_delete_job

| 项 | 设计 |
|----|------|
| **入参** | jobId（必填） |
| **handler** | 调 `DeleteTheJob`（**DELETE** `/v1/job/{job_id}/delete`，openapi 实测为 HTTP DELETE）→ 规范化输出 `{job_id, deleted: true}`（原始响应 `result.job_id`） |
| **校验** | 无（删除前确认由**模型层**完成：SKILL 强制约束 #4，调用前必须向用户确认） |
| **边界** | 任务不存在 → E_API；已删除任务重复删除 → E_API（透传） |
| **错误** | E_PARAM / E_API / E_CONFIG / E_AUTH / E_NETWORK |

### 2.6 codeartsbuild_run_job

| 项 | 设计 |
|----|------|
| **入参** | jobId（必填）、parameter?（**字段名单数**）、scm? |
| **handler** | 调 `ExecuteJob`（POST `/v1/job/execute`）→ 规范化 |
| **校验** | parameter 每项含 `name`（≤128）+`value`（≤8192）必填；scm 按 openapi `Scm`：`build_commit_id?`/`build_tag?`/`branch?`/`build_type?`/`repo_id?`/`repo_name?` |
| **规范化** | 原始响应 `result.octopus_job_name` → jobId；`result.actual_build_number` → buildNo（Number 转换）；`result.daily_build_number` → dailyBuildNo；输出 `{job_id, buildNo, dailyBuildNo}` |
| **分支指定** | 分支经 `parameter` 传（如 `{name:"codeBranch", value:"develop"}`，实测生效）；`scm.branch` 服务端不支持（契约 §8 #4 已确认） |
| **边界** | 任务不存在/已删除 → E_API；并发触发同任务 → 返回新 buildNo（每次独立） |
| **错误** | E_PARAM / E_API / E_CONFIG / E_AUTH / E_NETWORK |

### 2.7 codeartsbuild_stop_job

| 项 | 设计 |
|----|------|
| **入参** | jobId（必填）、buildNo（必填） |
| **handler** | 调 `StopTheJob`（POST `/v1/job/{job_id}/stop`，body `{build_no}`）→ 规范化 |
| **校验** | buildNo ≥ 1；jobId+buildNo 必须配对（同一次 run_job 返回或同一历史记录） |
| **规范化** | 原始响应仅 `{status: success}`；工具层回填入参输出 `{job_id, build_no, stopped: true}` |
| **边界** | 构建已终态 → 返回 `stopped: false` + 当前状态（非异常，提示 LLM）；buildNo 不存在 → E_API |
| **错误** | E_PARAM / E_API / E_CONFIG / E_AUTH / E_NETWORK |

### 2.8 codeartsbuild_get_status

| 项 | 设计 |
|----|------|
| **入参** | jobId（必填）、buildNo（必填，path） |
| **handler** | 调 `ShowJobBuildRecordDetail`（GET `/v1/record/{job_id}/{build_no}/record-info`）→ 规范化 |
| **规范化** | 状态在 `result.status`（实测 STARTED/SUCCESS/FAILED，2026-09-18 落定）；工具层**映射为契约状态枚举**（契约 §4.1 映射表）：STARTED→RUNNING、SUCCESS/FAILED 直映；输出 `{job_id, build_no, status, start_time?, end_time?, duration_ms?}`；其余状态（ERROR/CANCELED）以 `list_records` 查询兜底 |
| **边界** | **评审决策（2026-09-18）**：`ShowRunningStatus` **仅查 job 最新一次构建**（无 build_no 参数）**不能替代**本工具；原 `ShowJobStepStatus`（workflow.status 需结合 flow/error 解析，较难）**不再用于 get_status**，保留供 `wait_build` 轮询（需子步骤 flow 详情）；记录不存在 → E_API |
| **错误** | E_PARAM / E_API / E_CONFIG / E_AUTH / E_NETWORK |

### 2.9 codeartsbuild_list_records

| 项 | 设计 |
|----|------|
| **入参** | buildProjectId（必填）、page?, limit?, triggers?, branches?, tags?, fromDate?, toDate? |
| **handler** | 调 `ListRecords`（GET `/v1/record/{build_project_id}/records`）→ 规范化 |
| **校验** | **buildProjectId 为 36 位 UUID**（= ListJob 返回的 `build_project_id`，**非 32 位 project_id**——2026-09-18 实调用确认，契约 §8 #5）；page ≥ 0（默认 1）；limit 1~100（默认 10） |
| **规范化** | `result.data[]` → records[]（camelCase：build_no→buildNo、status_code→statusCode）；`result.pagination` → `{page, limit, total}` |
| **会话注入** | buildProjectId 缺省时取会话上下文（架构 §4.3）；显式传入覆盖 |
| **边界** | page/limit 已实调用确认正确透传（契约 §8 #5）；**注意：实测记录含 `ABORTED`/`STARTED` 状态**（契约 §8 #8，§4 状态枚举待修订） |
| **错误** | E_PARAM / E_API / E_CONFIG / E_AUTH / E_NETWORK |

### 2.10 codeartsbuild_get_record

| 项 | 设计 |
|----|------|
| **入参** | jobId（必填）、buildNo（必填） |
| **handler** | 调 `ShowJobBuildRecordDetail`（GET `/v1/record/{job_id}/{build_no}/record-info`）→ 原样返回 |
| **关键输出** | `result.build_record_id`（→ recordId，供 get_log）；`result.execution_id`（日志查询）；`result.devcloud_project_id`（→ projectId）；`result.status`（终态判定） |
| **校验** | jobId+buildNo 配对；buildNo ≥ 1 |
| **边界** | 记录不存在 → E_API；`err_msg` 非空时透传 |
| **错误** | E_PARAM / E_API / E_CONFIG / E_AUTH / E_NETWORK |

### 2.11 codeartsbuild_list_artifacts

| 项 | 设计 |
|----|------|
| **入参** | jobId（必填）、buildNo（必填） |
| **handler** | 经 `HttpClient` 调 `ShowNewOutput`（GET `/v1/job/{job_id}/{build_no}/output`，AK/SK 签名，与普通工具同构——自建 HTTP 承载后无 token 依赖，2026-09-20 更新） |
| **规范化** | 原始 `result.package_infos[]`（软件包）/`result.image_infos[]`（镜像）→ 统一结构体数组 `artifacts[]`（type 映射：条目 `type=package`→`artifact`、`type=image`→`image` + `name` + `version` + `package_type` + `uri` + `console_url` + `record_id`），详见 operations/artifacts.md §1 |
| **type 映射** | OutPutResult.type 枚举 `package`/`image` → 统一结构体 type `artifact`/`image`（介质）；package_type 枚举 cmake/jar/py/zip/txt/yml/html 用于 language 推断 |
| **console_url** | 按产物类型拼接控制台页面链接（架构 §12 #3 待环境对齐） |
| **下载策略** | 当前版本**不提供下载**（download_url 需 token），仅 console_url 跳转；M2 规划 |
| **边界** | **无 obs 字段**（openapi 定义仅 package_infos/image_infos/user_properties；OBS 产物待实测确认，契约 §8 #2）；构建未完成 → 返回空列表 + `status` 提示 |
| **错误** | E_PARAM / E_API / E_AUTH / E_NETWORK / E_CONFIG |

### 2.12 codeartsbuild_list_templates

| 项 | 设计 |
|----|------|
| **入参** | name?, page?, pageSize?（openapi 无 tags 参数） |
| **handler** | 调 `ListOfficialTemplate`（GET `/v1/template/officialtemplates`）→ 规范化 |
| **校验** | name 长度 1~115；page ≥ 0（默认 0，openapi 为 string）；pageSize 1~100（query 名 `page_size`） |
| **规范化** | `result.items[]` → templates[]（name/description/scope/template.steps）；`result.total_size` → total；**steps[].module_id 为全限定名**（如 `devcloud2018.codeci_action_20018.action`），可直接作为 create_job.steps 入参 |
| **边界** | 用户自建模板用 `ListCustomTemplate`（`/v1/template/custom`）——本期工具仅暴露官方模板，自建模板后续扩展 |
| **错误** | E_PARAM / E_API / E_CONFIG / E_AUTH / E_NETWORK |

### 2.13 codeartsbuild_get_log

| 项 | 设计 |
|----|------|
| **入参** | recordId（必填）、logLevel?, maxBytes?, compress?（openapi 支持 `compress` query） |
| **handler** | 调 `DownloadBuildFullLog`（GET `/v1/log/{record_id}/download-log`，openapi 确认）→ **解压（实测返回 ZIP 压缩包，PK 头，2026-09-18 确认，契约 §8 #10）** → 原始日志文本 → 调 log-cleaner 清洗 |
| **调用约束** | 仅构建失败或用户显式要求（SKILL 强制约束 #5） |
| **校验** | recordId 非空（来自 get_record 的 `build_record_id`，36 位 UUID `^[0-9a-z-]{36}$`）；logLevel ∈ {INFO, DEBUG}；maxBytes 默认 256KB |
| **解压** | HTTP 下载（`DownloadBuildFullLog` v1）返回内容为 ZIP；工具层需识别 PK 头并解压（zip 库），解压后取 message.txt 或主日志文件 |
| **清洗** | **详细设计见 `docs/design/log-cleaner.md`**（三区采样、错误分类表、脱敏）；此处仅规范工具边界 |
| **大日志** | HEAD+TAIL+错误上下文三区采样；`truncated=true` 时附 console_url 提示全文 |
| **边界** | recordId 无效 → E_API；日志下载失败 → E_LOG；日志过大截断 → truncated=true |
| **错误** | E_PARAM / E_API / E_LOG / E_CONFIG / E_AUTH / E_NETWORK |

### 2.14 codeartsbuild_wait_build

| 项 | 设计 |
|----|------|
| **入参** | jobId（必填）、buildNo（必填）、intervalMs?, timeoutMs?, maxBackoffMs? |
| **handler** | 循环调 `ShowJobStepStatus`（GET `/v1/job/{job_id}/status`，openapi `result.workflow.status`——**与 get_status 不同**：get_status 已改用 `ShowJobBuildRecordDetail`，wait_build 保留 `ShowJobStepStatus` 以获取子步骤 flow 详情），按契约 §2.14 轮询策略执行 |
| **轮询策略** | 初始 `intervalMs`(默认 10s) → 指数退避 ×1.5 至 `maxBackoffMs`(默认 30s)；总超时 `timeoutMs`(默认 30min，上限 2h) |
| **终态判定** | `workflow.status` 映射后 ∈ `{SUCCESS, FAILED, ERROR, CANCELED, COMPLETED}` 任一即停（契约 §4.2；映射见 §2.8） |
| **超时行为** | 返回 `status=TIMEOUT` + `last_status`/`last_start_time`/`elapsed_ms`，**不抛异常**（E_TIMEOUT 仅用于内部记录，对外非 isError） |
| **网络抖动** | 单次查询失败重试 ≤2 次（间隔 2s），不影响退避计数 |
| **子进程承载** | **待办 #12**：轮询 loop 移入 `child_process` 子进程，避免阻塞 dsh 主进程；子进程管理（超时/终止/回收）见 AGENTS.md #12 与架构演进 |
| **错误** | E_PARAM / E_API / E_CONFIG / E_AUTH；网络失败重试超限 → E_NETWORK |

---

## 3. create_job 详细设计（重点）

### 3.1 职责定位

`codeartsbuild_create_job` 是**本地构建 → 云端任务**的关键落点：将 `repo_build` 的产物（recommended_steps）或 `list_templates` 的官方模板，组装为合法的 `CreateNewJob` 请求体（对齐 openapi.yaml `CreateBuildJobRequestBody`）。

### 3.2 入参（与契约 §2.4 一致）

| 参数 | 类型 | 必填 | 校验规则 |
|------|------|------|----------|
| projectId | string | ✅ | 非空；**缺省时取会话上下文**（架构 §4.3）；格式：UUID 32 位数字字母（宽松校验，最终由 API 裁决） |
| jobName | string | ✅ | 非空；长度 1~115；合法字符：中英文/数字/下划线/连接符；**重名检查**（可选：先 list_jobs(search=jobName) 确认无冲突，有冲突提示改名或走 update） |
| arch | string | ✅ | 非空；**枚举 `x86-64` / `arm`**（openapi 定义，注意为短横线） |
| stepsPlan | array | ⚠️* | **意图级步骤计划（推荐）**：`[{ step, properties? }]`——`step` 为 step-templates.json 的 `template_id`（推荐）或 module_id（高级）；**数组顺序即构建步骤顺序**；`properties` 覆盖该步默认参数（如 command/image/file）；组装器补全 module_id/name/未覆盖默认值（见 §3.4）；step 必须来自 step-templates.json 或白名单 |
| language | string | ❌ | 语言/场景标识（stepsPlan 缺省时速选）：对齐 step-templates.md §1 组合（如 `Java/Maven（jar）`、`JavaScript/npm`、`Go`）；展开为默认组合（顺序+参数由模板定义） |
| steps | array | ❌ | 构建步骤（**原样透传，高级用法，最高优先**）；非空；每项必填 `module_id`（**全限定名**）+ `name`；可选 `properties`/`version`/`enable`；module_id 必须来自白名单（见 §3.3） |
| scms | array | ❌ | 每项含 `scm_type`/`repo_id`/`repo_name`/`branch`/`url`/`web_url`/`build_type` 等；scm_type 枚举：gitee_private\|codehub\|gitee\|github\|general_git\|externalGit\|gerrit\|tfs_git\|gitcode\|other_project_codehub\|bitbucket（openapi 定义） |
| parameters | array | ❌ | **双层结构**：`[{name: "hudson.model.StringParameterDefinition", params: [{name, value}]}]`（见 §3.4） |
| description | string | ❌ | 任务描述 |
| flavor | string | ❌ | 执行机规格（如 DEFAULT / 2u8g，不传用服务端默认） |
| hostType | string | ❌ | 主机类型（custom_host / custom_acc / devcloud，默认 devcloud） |
| buildConfigType | string | ❌ | 构建配置类型（YAML / ACTION，默认 ACTION） |
| sourceCode | string | ❌ | 代码源类型（pipeline / codeci） |
| buildIfCodeUpdated | boolean | ❌ | 提交代码触发构建开关（默认 false） |
| autoUpdateSubModule | string | ❌ | 是否自动更新子模块（false/true，默认 false） |
| agencyUrn | string | ❌ | 委托 urn |
| groupId | string | ❌ | 任务分组 ID |

> \* steps 在 openapi 定义中非必填（必填仅 arch/project_id/job_name），但**无 steps 的任务无构建意义**：`steps`/`stepsPlan`/`language` 三选一必填；优先级 `steps` > `stepsPlan` > `language`。

### 3.3 module_id 白名单（禁止臆造，全限定名）

> **核心规约**：模型不得臆造 `module_id`。**module_id 为全限定名**（形如 `devcloud2018.codeci_action_XXXXX.action`），非短名（maven/npm 等）。合法来源仅三处（契约 §2.16 约束）：
> 1. `repo_build` 返回的 `recommended_steps[].module_id`
> 2. `list_templates` 返回的 `template.steps[].module_id`
> 3. 已实测白名单（下表，**2026-09-18 `ListOfficialTemplate` 实测 33 个官方模板拆解**，完整默认 properties 见 `docs/design/step-templates.md` §2/§3，权威插件清单见 §4）

**核心构建 step 白名单**（已过滤不维护插件，完整清单见 step-templates.md §4）：

| module_id（全限定名） | 语义 | 语言 |
|-----------|------|------|
| `devcloud2018.codeci_action_20043.action` | Maven 构建 | java |
| `devcloud2018.codeci_action_20008.action` | Gradle 构建 | java |
| `devcloud2018.codeci_action_20032.action` | Android 构建 | java |
| `devcloud2018.codeci_action_20014.action` | npm 构建 | javaScript |
| `devcloud2018.codeci_action_20015.action` | PyInstaller | python |
| `devcloud2018.codeci_action_20026.action` | Go 语言构建 | go |
| `devcloud2018.codeci_action_20037.action` | PHP 构建 | php |
| `devcloud2018.codeci_action_20005.action` | CMake 构建 | C/C++ |
| `devcloud2018.codeci_action_20017.action` | 执行 shell 命令 | 通用 |
| `devcloud2018.codeci_action_20071.action` | 单元测试报告 | 通用（报告处理） |
| `devcloud2018.codeci_action_20035.action` | 执行 Docker 命令 | 通用 |

> **不维护插件（2026-09-18 用户确认，不在 create_job 白名单）**：Ant `20002`、Bazel `20055`、Yarn `20019`、Grunt `20010`、gulp `20011`、Android 快应用 `20036`、SetupTool `20016`、Gnu-arm `20007`、Msbuild `20020`、Sbt `20046`、Grails `20009`、mono `20013`、HarmonyOS `20075`、Android APK 签名 `20033`、Kotlin `20072`、Flutter `20062`。对应场景走自定义构建环境（`20017` shell + 自定义 image）或自定义执行机 linux 模式。

**通用附加 step 白名单**：

| module_id（全限定名） | 语义 | 备注 |
|-----------|------|------|
| `devcloud2018.codeci_action_20018.action` | 上传软件包到软件发布库 | 多数语言模板标准尾步 |
| `devcloud2018.codeci_action_20004.action` | 制作镜像并推送到 SWR 仓库 | 容器类模板尾步 |
| `devcloud2018.codeci_action_20022.action` | 上传软件包（archive.zip） | MSBuild 系专用 |
| `devcloud2018.codeci_action_20057.action` | 上传 OBS 对象 | OBS 交付（bucketName 必填） |
| `devcloud2018.codeci_action_20063.action` | 下载 OBS 对象 | OBS 拉取（bucketName/objectKey 必填） |

> **字段来源（2026-09-18 补充）**：各 step 的 properties 字段定义、image 可选值、必填项以 **action 参数定义 + `CodeArtsPipeline ListModulesDetail` 实时接口实测**为准（`codeci_action_XXXXX` 的 parameters schema，与 module_id 一一对应）；完整模板见 `docs/design/step-templates.md` §2/§3，权威插件清单（36 个，其中 16 个不维护插件已过滤）见 §4。

> **repo_type → module_id 默认映射**（契约 §2.16 引用）：maven→`20043`、gradle→`20008`、npm→`20014`、yarn→`20019`、go→`20026`、python→`20016`（Setuptools）、php→`20037`、cmake→`20005`、msbuild→`20020`、docker→`20004`。⚠️ 其中 yarn `20019`/setuptools `20016`/msbuild `20020` 为**不维护插件**——映射仅用于语言识别，创建任务时改用 shell 自定义或对应支持工具。
>
> **语言 → steps 推荐组合**：见 `docs/design/step-templates.md` §1（如 Java/Maven → `20043`+`20018`；npm 容器 → `20014`+`20004` 等）。
>
> 非白名单 module_id → E_PARAM（字段级报错，指明"module_id 必须取自 recommended_steps / list_templates / 实测白名单"）。

### 3.4 模板化组装（工程内 template-assembler）

**组装策略**：模板组装是**工程实现**（bundle 内 `src/providers/codeartsbuild/template-assembler.ts`），非 LLM 手工拼全限定名——模型表达**意图级步骤计划**（`stepsPlan`：步骤顺序 + 每步参数），组装器补全 module_id/默认值产出合法 steps。`steps` 原样透传（最高优先级），`language` 速选默认组合。

**steps 组装优先级**：

```
1. input.steps 显式传入 → 原样使用（模型自定义，module_id 必须白名单）
2. input.stepsPlan 传入 → 组装器逐项解析（step→模板/模块，合并 properties，顺序=数组顺序）
3. input.language 传入 → 组装器按 §1 组合展开默认组合（顺序+参数由模板定义）
4. 三者皆无 → E_PARAM（提示传 steps / stepsPlan / language）
```

**组装器接口**（`src/providers/codeartsbuild/template-assembler.ts`）：

```typescript
// 数据源：bundle 内打包 step-templates.json（14 模板）/ config-template.json（请求骨架）
// 语言组合映射：对齐 step-templates.md §1（Java/Maven（jar）→ [maven-build, upload-release] 等）
function resolveStep(stepRef: string): Template;             // step（template_id 或 module_id）→ 模板
function assembleSteps(input): Step[];                      // stepsPlan/language → steps[]（顺序即数组）
function assembleConfig(req): CreateNewJobRequest;          // 注入 config-template.json 占位
function validateSteps(steps): void;                        // module_id 白名单（§3.3）
```

**组装规则**：

| 项 | 规约 |
|----|------|
| 步骤顺序 | **`stepsPlan` 数组顺序即构建步骤顺序**（模型定义）；`language` 展开为 §1 组合的固定顺序 |
| 步骤引用 | `stepsPlan[].step` 取 `template_id`（推荐，如 `maven-build`）或 `module_id`（高级，全限定名）；未匹配 → E_PARAM 列出可用模板 |
| 默认 properties | 取 `step-templates.json` 模板 properties（default_properties + 必填占位，preCondition=SUCCESS） |
| 参数覆盖 | `stepsPlan[].properties` 合并进该步默认 properties（如自定义 command/image/file） |
| 组合速选 | `language` 精确匹配 §1 组合表（`Java/Maven（jar）`、`JavaScript/npm`、`Go`、`产物传 OBS` 等）；未匹配 → E_PARAM 列出可用值 |
| scms | 本地仓库有远端时自动填充 `{scm_type: "codehub", repo_id, repo_name, branch, url, web_url}`；未知则留空（后续 update_job 补） |
| parameters | **双层结构**：`[{name: "hudson.model.StringParameterDefinition", params: [{name: "name", value: "codeBranch"}, {name: "type", value: "normalparam"}, {name: "defaultValue", value: "master"}, ...]}]`；简单场景可传空数组 `[]` |
| flavor | 不传默认；大项目可显式指定执行机规格 |
| hostType/buildConfigType | 默认 devcloud / ACTION，一般无需模型指定 |

**组装伪代码**：

```typescript
function assembleCreateJob(input): CreateNewJobRequest {
  const steps = input.steps ?? assembleSteps(input);        // 显式 steps 最高优先；否则 stepsPlan/language
  validateSteps(steps);                                     // module_id 全限定名白名单校验
  const scms = input.scms ?? inferScms(input);              // 本地 repo 远端自动推断（scm_type: "codehub"）
  return {
    arch: input.arch,
    project_id: input.projectId,
    job_name: input.jobName,
    steps,
    scms,
    parameters: input.parameters ?? [],
    description: input.description,
    flavor: input.flavor,
    host_type: input.hostType ?? "devcloud",
    build_config_type: input.buildConfigType ?? "ACTION",
    source_code: input.sourceCode,
    build_if_code_updated: input.buildIfCodeUpdated ?? false,
    auto_update_sub_module: input.autoUpdateSubModule ?? "false",
    agency_urn: input.agencyUrn,
    group_id: input.groupId,
  };
}

function assembleSteps(input): Step[] {
  // ① stepsPlan：意图级步骤计划（顺序 + 每步参数）
  if (input.stepsPlan) {
    return input.stepsPlan.map(plan => {
      const tpl = resolveStep(plan.step);                   // template_id 或 module_id → 模板
      return { module_id: tpl.module_id, name: tpl.name,
               properties: { ...tpl.properties, ...(plan.properties ?? {}) },
               enable: true };
    });
  }
  // ② language：速选默认组合（§1 映射，顺序+参数由模板定义）
  const refs = selectTemplates(input.language);
  return refs.map(ref => {
    const tpl = loadTemplate(ref.template_id);
    return { module_id: tpl.module_id, name: tpl.name, properties: tpl.properties, enable: true };
  });
}
```

### 3.5 handler 流程

```
① 参数校验（§3.2 表）→ 失败 E_PARAM（字段级）
② projectId 会话注入（缺省取上下文，显式覆盖）
③ 重名检查（可选：list_jobs(search=jobName)）
④ steps 组装（§3.4：显式 steps / language 模板组装 / 报错）
⑤ module_id 全限定名白名单校验（§3.3）
⑥ 调 CreateNewJob（POST /v1/job/create）
⑦ 成功 → 解析 result.job_id → {job_id, created: true}；失败 → 透传 E_API
⑧ 更新会话上下文（projectId 最新值）
```

### 3.6 边界与错误

| 场景 | 行为 |
|------|------|
| steps 为空 | E_PARAM："steps 必填，先 repo_build 或 list_templates 获取" |
| module_id 不在白名单 | E_PARAM 字段级："module_id=xxx 非法，必须取自 recommended_steps/list_templates/实测白名单" |
| arch 非 x86-64/arm | E_PARAM 提示枚举 |
| jobName 重名 | E_API（服务端拒绝）或提示改名；创建前可选预检 |
| projectId 非法 | E_API → 提示 `list_projects` 重选 |
| 创建成功但响应缺 result.job_id | E_API（透传原始响应，视为异常） |

---

## 4. repo_build 详细设计（引用）

`codeartsbuild_repo_build` 为本地构建域唯一工具，**内部完整设计见 `docs/design/repo-analyzer.md`**（探测/编译指导/执行/产物/留档五段 + 模型自决规约），本文仅列工具边界：

| 项 | 规约 |
|----|------|
| 入参 | repoPath（必填）、repoType?、buildCommandHint?、timeoutMs?（契约 §2.16） |
| 内部步骤 | ① fs 探测仓库类型 → ② 编译指导 → ③ child_process.spawn 执行（stdout/stderr 尾部各 4KB）→ ④ 失败正则分类异常 → ⑤ glob 扫描产物 → ⑥ 留档 `.codeartsbuild/build-records/` |
| 产物 | 统一结构体 `type: local`（operations/artifacts.md §1） |
| recommended_steps | 与 create_job.steps 同构（§3.4 直接可用）；**module_id 须为全限定名**（`devcloud2018.codeci_action_XXXXX.action`），repo_build 从工具内置映射表（对齐 list_templates 实测）产出，禁止臆造 |
| 模型自决 | 编译命令/修复策略由模型判断；工具只返回结构化结果 |
| 子进程 | 编译执行用 child_process（待办 #12 统一评估进程管理） |

---

## 5. 与契约的映射核对

| 工具 | 契约节 | 详细设计节 | 一致性要点 |
|------|--------|-----------|-----------|
| list_projects | §2.1 | §2.1 | 字段映射 identifier→projectId |
| list_jobs | §2.2 | §2.2 | result.job_list + build_status 枚举 |
| get_job | §2.3 | §2.3 | get_all_params + module_id 全限定名 |
| create_job | §2.4 | §3 | 模板化 + 全限定名白名单 + 会话注入 |
| update_job | §2.5 | §2.4 | 全量覆盖语义 |
| delete_job | §2.6 | §2.5 | HTTP DELETE + 删除前模型层确认 |
| run_job | §2.7 | §2.6 | parameter 单数 + octopus_job_name/actual_build_number |
| stop_job | §2.8 | §2.7 | jobId+buildNo 配对 + 响应回填 |
| get_status | §2.9 | §2.8 | workflow.status 映射（接口待定，契约 §8 #7） |
| list_records | §2.10 | §2.9 | page+limit 分页 + result.data（ABORTED 冲突 §8 #8） |
| get_record | §2.11 | §2.10 | build_record_id→recordId |
| list_artifacts | §2.12 | §2.11 | 手动 HTTP + package_infos/image_infos |
| list_templates | §2.13 | §2.12 | result.items + module_id 全限定名 |
| wait_build | §2.14 | §2.14 | 轮询策略 + workflow.status 终态判定 |
| get_log | §2.15 | §2.13 | 清洗见 log-cleaner.md + compress 参数 |
| repo_build | §2.16 | §4 | 见 repo-analyzer.md |

---

## 6. 编码落点（src 映射）

| 详细设计 | 源码位置（架构 §4.1） |
|----------|----------------------|
| 通用骨架/错误映射 | `src/tools/index.ts` + `src/infra/tool-result.ts` |
| 各工具 handler | `src/providers/codeartsbuild/index.ts`（云侧 15 工具） |
| repo_build | `src/providers/local-build/`（probe/guidance/build/artifact/archive） |
| create_job 组装 | `src/providers/codeartsbuild/template-assembler.ts`（新增，承载 §3.3/§3.4 模板化） |
| get_log 清洗 | `src/infra/log-cleaner.ts` |
| wait_build 轮询 | `src/core/lifecycle.ts`（子进程承载待办 #12） |
| 工具 schema | `src/tools/schemas.ts`（schemastery 定义） |
