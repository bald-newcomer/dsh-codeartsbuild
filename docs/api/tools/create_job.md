# 工具契约 — codeartsbuild_create_job

> **来源**: `docs/api/api-contract.md` §2.4（工具接口契约，唯一事实来源）

### 2.4 codeartsbuild_create_job

创建新的构建任务。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_create_job` |
| **场景** | C. 任务编排 |
| **描述** | 创建任务（入参较复杂），**支持模板化组装**：传 `stepsPlan`（意图级步骤计划：**步骤顺序 + 每步参数**，推荐）或 `steps`（原样透传，高级）；支持上传软件包、上传镜像、上传 OBS、下载 OBS |
| **KooCLI 操作** | `CreateNewJob`（POST） |
| **URL** | `/v1/job/create` |
| **注意** | 调用前先 `subagent`（本地构建探索）跑通编译取 build info，或 `list_templates` 获取可用模板；**`arch` 为必填**；**任务名查重机制化（FE-15）**：创建前工具自动 `list_jobs(search=jobName)` 自查，命中同名 → E_PARAM 引导改名创建（加 -v2 等后缀），不重复新建（服务端 422 `DEVCB.00031075` 兜底）；**step 字段契约机制化（FE-16 §2.1）**：`steps[].properties` 键名必须在模板白名单内（`shellContent` 不在 shell-command 模板 → E_PARAM + 推荐 `command`）；**模板选用 mismatch 检测（FE-17 §2.1）**：传 `projectRepoType`（来自 subagent build_info）+ steps 含 `shell-command` 但项目语言有对应 core_tool 模板 → E_PARAM 引导改用对应模板（如 python→`pyinstaller-build`，覆盖 command 为 `pip install + pytest`）；**language 模糊匹配（FE-16 §2.4）**：无完全匹配时挑最相近的（`Python/uv` → `Python/其他（setuptools 等）`），无匹配 → E_PARAM 列可用语言；steps 组装：① 显式 `steps` 最高优先；② `stepsPlan`（意图级，顺序+参数）由组装器补全 module_id/默认值；③ `language` 速选默认组合（`step-templates.json` + 语言组合映射，见 FE-04-Step模板库拆解-20260918.md §7）；模板化组装前模型可用 `list_templates` 预览官方模板 |

**输入参数**（openapi.yaml `CreateBuildJobRequestBody`，必填仅 arch/project_id/job_name；steps 业务上建议必填）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| arch | string | ✅ | 机器架构，**枚举 `x86-64` / `arm`**（openapi 定义） |
| projectId | string | ⚠️* | 项目 ID（UUID，32 位数字字母）；**缺省时取会话上下文**（架构 §4.3 优先级：显式 > 会话 > 配置默认值 > `list_projects` 询问），显式传入覆盖并更新会话上下文 |
| jobName | string | ✅ | 任务名称（中英文/数字/下划线/连接符，长度 1~115） |
| stepsPlan | array | ⚠️* | **意图级步骤计划（推荐）**：`[{ step, properties? }]`——`step` 为 step-templates.json 的 `template_id`（推荐）或 module_id（高级）；**数组顺序即构建步骤顺序**；`properties` 覆盖该步默认参数（如 command/image/file）；组装器补全 module_id/name/未覆盖默认值 |
| steps | array | ❌ | 构建步骤（**原样透传，高级用法**），每项含 `module_id`（**全限定名**）+ `name`（必填），可选 `properties`/`version`/`enable`；**最高优先** |
| scms | array | ❌ | 代码源，每项含 `scm_type`/`repo_id`/`repo_name`/`branch`/`url`/`web_url` 等；**来源强制（FE-07 §2.5）**：`scm_type` 仅支持实测的 `codehub`，`repo_id`/`url` 必须取自正确前置渠道，禁止臆造（见下「scm 字段来源强制表」）；**为空时软拦截**（见下「空 scms 软拦截」） |
| confirmEmptyScms | boolean | ❌ | 空 scms 创建确认（默认 false）：`scms` 为空且未确认 → 返回 `need_confirmation` 不创建（`created:false`）；**用户确认**确需无代码源任务（稍后 update_job 补 scms / 运行期 scm 覆盖 / 委托账号）后携带 `true` 重试才真正创建（FE-19 §2.2，2026-11-12 会话 ed0ef1ff：模型连两会话空 scms 先建，软提示被忽略） |
| parameters | array | ❌ | 自定义参数（**双层结构**，见下） |
| description | string | ❌ | 任务描述 |
| flavor | string | ❌ | 执行机规格，**当前仅 `DEFAULT` 合法**（缺省即 DEFAULT，2026-09-29 用户确认）；禁止臆造其他值（非法值 E_PARAM） |
| hostType | string | ❌ | 主机类型（custom_host / custom_acc / devcloud，默认 devcloud） |
| buildConfigType | string | ❌ | 构建配置类型（YAML / ACTION，默认 ACTION） |
| sourceCode | string | ❌ | 代码源类型（pipeline / codeci） |
| buildIfCodeUpdated | boolean | ❌ | 提交代码触发构建开关（默认 false） |
| autoUpdateSubModule | string | ❌ | 是否自动更新子模块（false/true，默认 false） |
| agencyUrn | string | ❌ | 委托 urn |
| groupId | string | ❌ | 任务分组 ID |
| projectRepoType | string | ❌ | 项目语言类型（FE-17 §2.1，来自 subagent build_info 的 repo_type）：`python`/`npm`/`maven`/`go`/`c`/`cpp`/`rust`/`other`；用于模板选用 mismatch 检测——python/npm/maven 等语言项目传 `shell-command` 跑语言命令（pip/npm/mvn）→ E_PARAM 引导改用对应 core_tool 模板（如 python→`pyinstaller-build`，覆盖 command 为 `pip install + pytest`）；缺省时不拦（兼容未跑 subagent 的场景） |

> \* steps 在 openapi 定义中非必填，但**无 steps 的任务无构建意义**，且 **KooCLI 封装实测要求 `--steps.[N].module_id`/`name` 必填**（hcloud help required）：`steps`/`stepsPlan` 二选一必填（FE-03-工具详细设计-20260918.md §3.2 校验规则）；优先级 `steps` > `stepsPlan`（`language` 速选已于 2026-11-06 废弃）。

**scm 字段来源强制表（FE-07 §2.5 O5，2026-09-23 落定）**——与 AGENTS.md「核心主键」表同构，字段值必须取自指定前置渠道，**不明确字段转人工确认，禁止臆造**：

| scm 字段 | 来源渠道（强制） | 是否可臆造 |
|----------|------------------|-----------|
| `scm_type` | 实测唯一的 `codehub`（CodeArtsRepo）；gitlab/github/gitee 等未实测禁用 | ❌ 禁止 |
| `repo_id` | ① CodeArtsRepo 建仓返回 ② `get_job`/`list_jobs` 已有任务回读 ③ 本地仓库已有远端解析 | ❌ 禁止 |
| `repo_name` | 建仓返回 / 已有任务回读 | ❌ 禁止 |
| `url` | CodeArtsRepo 仓库 URL（建仓/回读），**非**第三方 Git 平台 URL | ❌ 禁止 |
| `web_url` | 建仓返回 / 已有任务回读 | ❌ 禁止 |
| `branch` | 用户指定 / 默认分支（master/main）；服务端支持待确认 | ✅ 可默认 |
| `build_type` | 默认，留空 | ✅ |

> **前置渠道（create_job 组装 scm 前必走其一）**：① 本地仓库有远端(codehub) → 本地 `git remote` 解析；② 远端仓库流程（FE-07 §2.4 O4）→ 克隆/建仓硬返回回填；③ 参考已有任务 → `get_job`/`list_jobs` 抽取已验证 scm 结构；④ 均不可得 → **转人工确认**。
>
> **错误回流（实现已内置）**：`create_job` 返回「仓库不存在或仓库已被删除」（422）时，工具增强提示回溯 scm 来源渠道，不继续换 scm_type 重试。
>
> **空 scms 软拦截（2026-09-28 FE-09 P2-C → 2026-11-12 FE-19 升级）**：`scms` 为空且未携带 `confirmEmptyScms=true` 时，工具返回 `need_confirmation` 软拦截（`created:false`，**不创建**）——引导正确顺序 `repo_prepare(建仓取 remote_url/repo_id) → repo_push(推代码) → 再 create_job 带 scms`（`scm_type=codehub, repo_id` 取自 repo_prepare 输出）；已建任务可用 `update_job` 补 scms。**升级背景**：原仅附 `scms_empty_hint` 软提示（不拦截），模型连两会话（58dccf5f/ed0ef1ff）忽略提示"空 scms 先建"任务（任务无代码源，run_job 无仓库可构建）——按 FE-17 机制化方法论升级为 delete_job 同款 need_confirmation 软拦截。确需无代码源任务（稍后 update_job 补 scms / 运行期 scm 覆盖 / 委托账号）→ **用户确认后**携带 `confirmEmptyScms=true` 重试；空 scms + `agencyUrn` 时提示委托账号需绑定仓库（agencyUrn 须用户显式提供，模型不得自行填写绕过 scm 链路）。
>
> **实现规约**：请求体字段为 snake_case（`scm_type`/`repo_id`/`repo_name`/`web_url`/`build_type`）；工具入参兼容 camelCase（`scmType`/`repoId`）并在适配层映射。
>
> **stepsPlan 示例**（Maven 构建 → 上传软件包，自定义命令与产物路径）：
>
> ```json
> [
>   { "step": "maven-build", "properties": { "command": "mvn clean package -DskipTests" } },
>   { "step": "upload-release", "properties": { "file": "target/*.jar", "buildVersion": "1.0.0" } }
> ]
> ```

**steps 项结构**（openapi.yaml `CreateBuildJobSteps`，示例为 Maven 构建）：

```json
{
  "properties": { "image": "maven3.5.3-jdk8-open", "command": "mvn package -DskipTests", "cacheOption": "cached" },
  "module_id": "devcloud2018.codeci_action_20043.action",
  "name": "Maven构建",
  "version": "20231001.6",
  "enable": true
}
```

> **module_id 为全限定名**（`devcloud2018.codeci_action_XXXXX.action`），非短名（maven/npm 等）。合法值必须取自 `list_templates` 返回或实测白名单（FE-03-工具详细设计-20260918.md §3.3）。

**parameters 结构**（双层，非简单 `[{name,value}]`）：

```json
[
  {
    "name": "hudson.model.StringParameterDefinition",
    "params": [
      { "name": "name", "value": "codeBranch" },
      { "name": "type", "value": "normalparam" },
      { "name": "defaultValue", "value": "master" },
      { "name": "description", "value": "Code branch" },
      { "name": "deletion", "value": "false" },
      { "name": "defaults", "value": "true" },
      { "name": "staticVar", "value": "false" },
      { "name": "sensitiveVar", "value": "false" }
    ]
  }
]
```

**输出示例**（openapi 实测响应）：

```json
{
  "result": { "job_id": "db8467d972cc47f7a1bd2a3a3e77596a" },
  "error": null,
  "status": "success"
}
```

> 工具规范化输出：`{ job_id }`（从 `result.job_id` 提取）。
