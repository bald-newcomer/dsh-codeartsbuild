---
name: codeartsbuild
description: >
  【先加载再行动】用户要求创建/管理华为云 CodeArts Build（CodeArtsBuild）构建任务，
  或提到"构建任务"、"编译构建"、"build job"、"跑一下构建"、"构建失败"、"构建产物"、
  "创建构建"、"执行构建"、"查看构建状态"、"代码能编译吗"、"云端构建"等话题（即使
  未明确提到工具名）时，必须先调用 `skill` 工具加载本技能（name=codeartsbuild），
  再执行任何工具操作或仓库探索（含 glob/read/git/subagent 等）——不要先调
  `list_agents` 探测子 agent 能力（只列 continuable children，不反映 spawn 能力）。
  本技能为构建生命周期管理：本地编译构建探索（subagent）、云端任务创建/编排
  （create_job）、触发与停止（run_job/stop_job）、状态监控（get_status/wait_build）、
  产物与日志（list_artifacts/get_log）、失败诊断、配置管理（update_job/delete_job）、
  模板化创建（list_templates）、本地仓库准备（repo_prepare）。
compatibility:
  - 宿主命令工具 bash（非 Windows）/ pwsh（Windows）——repo_prepare 之后执行
    git push 需要；git 客户端已安装
  - dsh 插件：codeartsbuild（18 个 codeartsbuild_* 工具，经 ctx.tools.register 注册；**本 SKILL.md 经 ctx.skills.register 注册为同名 skill（2026-11-04）**——模型可用 `skill` 工具加载，或用户 `/skill codeartsbuild` 显式注入；宿主 dsh-base 已挂载 skill/skill-filesystem，插件 apply 时自动注册，无需额外配置）
  - 宿主子 agent 能力（FE-14）：宿主 `dsh-base` bundle 已挂载 `dsh-tool-subagent`（提供 `subagent` 工具），
    主 agent 可 spawn 一次性子 agent 自主探索本地构建（见 references/local-build-explorer.md）；
    **必须传 `run_in_background: false`**（宿主默认 continuable 后台模式，需显式 foreground 才能拿到结果）。
    **不要调 `list_agents` 查能力**——`list_agents` 只列已存在的 continuable children，不反映 spawn 能力
    （会话 1d8dc38a 实测：模型误调 `list_agents` 返回空后放弃 spawn，实际 `subagent` 工具由 `dsh-base` 已提供）
    ；`dsh-tool-subagent-control`（`list_agents`/`send_message`/`interrupt_agent`）不提供 spawn 能力
  - 凭据：env（CAB_AK/CAB_SK/CAB_REGION）/ file（.dsh-codearts），
    缺省自动探测
---

# CodeArtsBuild Skill（dsh 插件）

## 概述

本插件以 **dsh 插件（bundle）** 形态提供 18 个原子工具，覆盖完整构建生命周期：

- **本地构建探索**（B）：子 agent 自主探索跑通本地编译（FE-14），输出 build info JSON 指导云端构建——**需宿主挂载 subagent 能力**
- **云侧**：项目感知（A）/ 任务编排（C）/ 执行控制（D）/ 状态监控（E）/ 产物与日志（F/G）

底层华为云调用经 **自建 HTTP 承载**（AK/SK 签名，凭据经 `credentialSource` 注入：`env`（`CAB_AK`/`CAB_SK`/`CAB_REGION`）或 `file`（工作目录 `.dsh-codearts`）；缺省自动探测——CAB_AK → env；cwd 有 `.dsh-codearts` → file）。

## 工具清单

| 工具 | 定义 | 关键入参 |
|------|------|----------|
| `codeartsbuild_repo_prepare` | 本地仓库准备 CodeArtsRepo 仓库（建仓+回读 RepoInfo；push 由 repo_push 接手） | repoPath, projectUuid, repoName?, branch? |
| `codeartsbuild_repo_push` | 推送本地仓库代码到 CodeArtsRepo（内置一次智能尝试：代理+SSL 自动携带、origin 项目归属预检、**凭据机制化：accessToken→private-token 注入 + missing_credentials 预检**、失败分类） | repoPath, projectUuid, repoName?, branch?, remoteUrl?, proxyUrl?, sslVerify?, accessToken? |
| `codeartsbuild_get_push_credential` | 获取 push 凭据（token + authedUrl + 可执行命令示例）——**pwsh/git push 前调用，避免自行拼 URL** | remoteUrl, accessToken? |
| `codeartsbuild_list_projects` | 项目列表 | — |
| `codeartsbuild_list_jobs` | 任务列表（全局） | search?, pageIndex?, pageSize? |
| `codeartsbuild_get_job` | 任务详情 | jobId |
| `codeartsbuild_create_job` | 创建任务（支持模板化组装；**创建前自动任务名查重，命中同名 → 引导改名创建**；**scms 为空 → need_confirmation 软拦截（不创建，引导 repo_prepare→repo_push→带 scms 重试；确需无代码源任务须用户确认 + `confirmEmptyScms=true`）**） | projectId（用户填写）, jobName, arch, stepsPlan? 或 steps, scms?, confirmEmptyScms? |
| `codeartsbuild_update_job` | 更新任务 | jobId, body |
| `codeartsbuild_delete_job` | 删除任务（不可逆；**须 confirm=true 用户确认**） | jobId, confirm? |
| `codeartsbuild_list_templates` | 模板列表（**用户自定义模板 + 官方模板 + 本地 step 模板 + 组合场景**） | name?, page?, pageSize?, filter?, tags?, source?（custom/official/all） |
| `codeartsbuild_run_job` | 触发构建 | jobId, parameter?, scm? |
| `codeartsbuild_stop_job` | 停止构建 | jobId, buildNo |
| `codeartsbuild_get_status` | 状态查询（ShowJobBuildRecordDetail，result.status） | jobId, buildNo |
| `codeartsbuild_list_records` | 构建历史列表 | projectId, page?, limit? |
| `codeartsbuild_get_record` | 记录详情（含 record_id） | jobId, buildNo |
| `codeartsbuild_wait_build` | 等待终态（轮询） | jobId, buildNo |
| `codeartsbuild_list_artifacts` | 产物清单（软件包/镜像） | jobId, buildNo |
| `codeartsbuild_get_log` | 日志拉取+清洗 | recordId, logLevel?, maxBytes? |

## 数据来源映射（强制）

工具调用相互独立，可任意顺序调用，但**参数必须从正确前置渠道获取**，否则调用必然失败。核心是主键依赖链：

```
project_id →(用户填写) create_job → job_id → run_job → build_no → get_record → record_id → get_log
```

| 主键 | 来源渠道（强制） | 需要它的工具 |
|------|-----------------|--------------|
| **project_id** | 用户指定或 `list_projects` 选择（会话级缓存：一次填写复用，显式传参覆盖） | `create_job` / `list_records` |
| **job_id** | `create_job` 返回；或 `list_jobs` 按名称（`search`）搜索 | `get_job` / `update_job` / `delete_job` / `run_job` / `stop_job` / `get_status` |
| **build_no** | `run_job` 生成（每次构建独立，同 job 内递增） | `stop_job` / `wait_build` / `get_record` / `list_artifacts` / `get_status` |
| **record_id** | `get_record(jobId, buildNo)`（唯一来源） | `get_log` |

### 强制约束要点（调用行为规约）

> 标注【机制化】的条目工具已硬约束，模型无需主动校验；条目保留作为参数填写引导与编排上下文。

1. **projectId 会话级缓存**【机制化】：工具自动按 显式入参 > 会话 > 配置默认值 解析；缺省报 E_PARAM 引导。主键来源见上方依赖链表。
2. **jobId+buildNo 必须配对**：5 个工具需同一构建的取值（同一次 `run_job` 返回或同一历史记录），不可混用。
3. **`delete_job` 须 `confirm=true`**【机制化】：工具缺省返回 `need_confirmation` 不执行删除——模型须向用户确认后携带 `confirm=true` 重试。
4. **`get_log` 按需调用**：仅构建失败或用户显式要求（日志分析指引见 references/local-build-and-log.md）。
5. **重试上限 3 轮**：同一错误累计 3 轮修复无果，必须升级用户——避免无限改参硬试（实测暴露过 5 轮硬试才转向）。
6. **create_job scm 字段来源**【机制化】：工具校验 `scm_type` 仅 `codehub`、`repo_id` 必填、拒第三方 URL、项目一致性；`repo_id`/`url` 取自 `repo_prepare` 输出或 `get_job` 回读，来源不明转人工。**空 scms 软拦截【机制化】**：`scms` 为空时工具返回 `need_confirmation` 不创建（`created:false`），引导 `repo_prepare → repo_push → 带 scms 重试`；确需无代码源任务（稍后 update_job 补 scms / 运行期 scm 覆盖 / 委托账号）→ **向用户确认后**携带 `confirmEmptyScms=true` 重试（2026-11-12 会话 ed0ef1ff：模型连两会话空 scms 先建，软提示被忽略，升级软拦截）。
7. **项目隔离**：所有操作**只允许在当前会话 projectId 内进行**；需操作其他项目时，必须先经用户显式确认并切换 projectId（会话上下文刷新）。
8. **agencyUrn 来源强制**：`create_job` 的 `agencyUrn` 默认空（不使用）；**模型不得自行填写**，须用户显式提供才透传。曾发生模型用 `agencyUrn` + 空 scms 绕过 scm 链路致任务无代码源（FE-09 D4 缺陷）——模型不得用 agencyUrn 作为 scm 失败的绕过通道；scm 链路不通时按规约 #5/#6 转人工求助，不得退化为空 scms + agencyUrn。
9. **git push 凭据**【机制化】：`repo_push` 的 `accessToken` 来源链——**显式入参 > 环境变量 `CAB_CODEARTSREPO_TOKEN` > `.dsh-codearts` 文件的 `CAB_CODEARTSREPO_TOKEN` 键**。用户提供令牌后工具自动注入 `private-token` 凭据（不写盘/不进输出）；无令牌且本地无凭据时返回 `missing_credentials` 引导。`CAB_AK`/`CAB_SK` 仅用于云侧 API 签名，不得当 push 凭据。**`repo_push` 失败后转用 pwsh/bash 手动推送时，必须先调 `get_push_credential` 取 token + authedUrl + 可执行命令**（返回的 `commands` 字段含可直接复制的命令）——禁止凭记忆自行拼 URL（曾 `oauth2:`/裸 token/`AK:SK` 拼接均实测被拒 CH.00905401）。
10. **create_job 任务名查重 + 构建失败优先 update 修复**【机制化】：工具创建前自动 `list_jobs(search=jobName)` 查重，命中同名 → E_PARAM 引导改名创建（加 -v2 等后缀）。**构建失败优先 `update_job` 修复而非 `delete_job` 重建**（FE-17 §2.5，会话 652fb005：4 轮 delete 重建）——`delete_job` 的 `need_confirmation` next_actions 已引导"优先 update_job 修复"；只有任务结构错误（jobName 错/scms 错/任务类型错）才 delete 重建。
11. **宿主 git 操作安全**（FE-12 P2，8155dd01 实测）：用宿主命令（bash/pwsh）执行 git 时——① **禁止 `git reset --hard` / `git checkout -- .` / `git clean -f`**（破坏性命令会丢弃工作区/未提交变更，曾 `reset --hard` 致 `src/` 丢失靠 reflog 自救）；撤销变更用 `git stash` / `git checkout -- <具体文件>`（指向性恢复）。② push 前 `git status` 确认工作区干净；本地领先 origin 直接 push，分歧用 `git pull --rebase`（不用 merge 避免多余合并提交）。③ git 命令失败先验证实际效果（`git log`/`git status` 确认），`exit code 1` 可能是 msys DLL 噪音（`CreateFileMapping` 等）而命令实际成功，勿 panic。④ **撞受保护分支（PROTECTED_BRANCH，FE-16 §2.3，e3c9f738 会话实测）**：`git push -f` 撞 `master 分支受保护` 时**禁止重试 -f**，改走 `git pull --rebase origin <branch>` 后 `git push`（非 `-f`），或联系管理员开临时强推权限；`repo_push` 返回 `error_type:PROTECTED_BRANCH` + next_actions 时按此处理。
12. **镜像字面量照抄**【机制化】：覆写 `properties.image` 时**必须原样抄写** `image_select` 中的值（如 `nodejs20`）——服务端镜像标识符字面量，禁止补全/加补丁号/变体（`nodejs20` 不要写成 `nodejs20.18.0`，实测不存在致调度失败）；工具校验器会拦臆造值并推荐最接近的字面量。
13. **update_job body 携带 projectId + steps 字段契约**【机制化-参数引导】：`update_job` 的 body 需含 `projectId`（来自 `get_job` 返回配置），工具会按 显式 > 会话 > 配置 > get_job 回读 兜底；但**模型应主动带上**，避免依赖兜底链。`get_job` 输出含 `projectId` 字段，组装 body 时原样回填。**steps 字段契约（FE-16 §2.1）**：`update_job` body 的 `steps[].properties` 键名必须在模板白名单内（`shellContent` → E_PARAM 推荐 `command`），与 create_job 同源校验（update_job 内部调 assembleConfig）。
14. **rebase --continue 编辑器陷阱**（FE-13 P2，58dccf5f 实测）：宿主 git 执行 `git rebase --continue` 前**必须设非交互编辑器**（`$env:GIT_EDITOR='true'` 或 `git -c core.editor=true rebase --continue`）——Git for Windows 不支持 `--no-edit`，裸命令会拉起 vim 在 PowerShell 非交互窗口挂起；报 `Unrecognized command or argument 'xxx'` 时先排查命令串/远端 URL/config 残留损坏参数（曾 `store` 残留污染后续所有 push），修正而非盲目重试。
15. **模板选用标准——按核心构建工具选模板**【机制化-参数引导】（FE-17 §2.1，2026-11-05 会话 652fb005）：选用标准是**核心构建工具**（不是 shell）。每个 step-template 的镜像对应一个核心工具：python→`pyinstaller-build`（镜像 python3.x），maven→`maven-build`，npm→`npm-build`，go→`go-build`，cmake→`cmake-build`，gradle→`gradle-build`，docker→`build-image-swr`。**`shell-command`（镜像 shell4.2.46 不含语言运行时）仅用于无语言运行时的纯 shell 任务**（脚本调度/文件操作）——不该跑 pip/npm/mvn 等。每个模板的默认 `command` 都可被 `properties.command` 覆盖（如 `pyinstaller-build` 默认 `python -m PyInstaller`，覆盖为 `pip install -r requirements.txt && pytest` 即变 Python 测试任务）。**机制化**：`create_job` 传 `projectRepoType`（来自 subagent build_info 的 `repo_type`）+ steps 含 `shell-command` 但项目语言有对应核心工具模板 → E_PARAM 拦截引导（如 python 项目用 shell-command 跑 pip → 引导改用 pyinstaller-build）。
13. **update_job body 携带 projectId**【机制化-参数引导】：`update_job` 的 body 需含 `projectId`（来自 `get_job` 返回配置），工具会按 显式 > 会话 > 配置 > get_job 回读 兜底；但**模型应主动带上**，避免依赖兜底链。`get_job` 输出含 `projectId` 字段，组装 body 时原样回填。
14. **rebase --continue 编辑器陷阱**（FE-13 P2，58dccf5f 实测）：宿主 git 执行 `git rebase --continue` 前**必须设非交互编辑器**（`$env:GIT_EDITOR='true'` 或 `git -c core.editor=true rebase --continue`）——Git for Windows 不支持 `--no-edit`，裸命令会拉起 vim 在 PowerShell 非交互窗口挂起；报 `Unrecognized command or argument 'xxx'` 时先排查命令串/远端 URL/config 残留损坏参数（曾 `store` 残留污染后续所有 push），修正而非盲目重试。

### create_job 的 steps 来源（二选一，优先级 `steps` > `stepsPlan`）

- **`stepsPlan`**（推荐，意图级步骤计划）：`[{ step, properties? }]`——`step` 为 step-templates.json 模板 id（如 `maven-build`/`upload-release`）或 module_id；**数组顺序即构建步骤顺序**；`properties` 覆盖该步默认参数（如 command/image/file）。模型按用户意图定义步骤顺序与每步参数。**参考组合见 references/language-combinations.md（语言→template_id 组合表，作为 stepsPlan 设计参考）**。
- **`steps`**（原样透传，高级）：取自 `list_templates` 返回的模板（全限定名 module_id + properties）。

**模板选择与查询职责**（详细见 references/language-combinations.md + references/step-templates.md）：
- **环境锚点**：以构建环境/语言族为锚点选模板（TS/JS/Node → npm `20014`，命令用 `properties.command` 覆盖），不以具体构建脚本切换模板；Shell `20017` 仅兜底。
- **module_id 白名单前置**：设计/规划阶段（写 stepsPlan、本地配置文件）就禁止自造 module_id 格式；取值只来自 `list_templates` 返回的 official_templates / step-templates.json 模板 id。
- **image 值必须取自 image_select 枚举**（FE-11 §6.1，机制层已校验）：覆写 `properties.image` 只能取 `step-templates.json` 该模板的 `image_select` 可用值（如 npm-build 的 nodejs8.11.2~nodejs24）或直接用模板默认值；**禁止臆造镜像版本**（实测 nodejs18.0.0 等不存在致构建调度失败，曾 6 轮空转）。无 `image_select` 的模板（如 upload-release）**不要覆盖 image**。可用值清单见 references/step-templates.md。
- **list_templates 查模板**：创建任务前调 `list_templates(source='official'|'custom'|'all')` 查最新模板——输出含 combination_scenarios（18 个组合表）+ custom/official_templates（official 已过滤过时模板）+ **official_step_templates（从官方模板 steps 抽取去重，结构对齐 step-templates.json——供 stepsPlan 选用最新 step 定义，含最新默认 command/image）**。有匹配 → 参考/复用其 steps；无匹配 → 用 `stepsPlan` 按 combination_scenarios 设计。

## 建议操作路径（按用户意图编排）

以下为常见用户意图的推荐编排流程。**推荐路径可裁剪**：用户意图只覆盖部分阶段时，可跳过不相关环节。

### 意图 1：从零到完成（本地构建 → 云端任务 → 产物）

```
用户：帮我基于当前项目构建并交付（projectId 由用户提供）
repo_prepare(取 remote_url/repo_id) → repo_push(remoteUrl=上一步 remote_url, accessToken=用户提供)
    → subagent(本地构建探索, 返回 build info JSON) → create_job → run_job → wait_build → list_artifacts
```

**本地构建探索（FE-14）**：**直接调宿主 `subagent` 工具 spawn 一次性子 agent**（不要先调 `list_agents` 查能力——`list_agents` 只列已存在的 continuable children，one-shot 不出现，不反映 spawn 能力；判断是否可 spawn 看 `subagent` 工具是否在工具列表中；`subagent` 工具由宿主 `dsh-base` bundle 已提供，不需要额外挂载）。**必须传 `run_in_background: false`**（宿主默认 continuable 后台模式，不传则异步返回 `started subagent <childId>` 而非 build info JSON；FE-14 需 foreground 等待子 agent 跑完返回结果）。prompt 使用 references/local-build-explorer.md 模板（填入 repoPath）。子 agent 自主探索跑通本地编译（pwsh 跑命令 → 看错误 → 改命令 → 再跑 → 跑通），返回固定 schema 的 build info JSON（status/repo_type/build_tool/build_environment/build_command/build_artifacts/attempted_commands）。主 agent 解析 build info 判断云端模板（image/steps）。

**仓库来源路由（create_job 前置，详见 references/repo-source-routing.md）**：先判定仓库类型——本地仓库（无远端）走 `repo_prepare` 建仓 → `repo_push` 推送代码（内置一次智能尝试：自动携带内网代理+SSL 关闭，凭据机制化注入 private-token，origin 项目归属预检，失败分类输出 next_actions，见 references/git-push.md）；本地仓库（已有 codehub 远端）走 `repo_prepare` 自动回读 repo_id；远端 codehub 仓库先 `git clone` 到本地 → 本地构建探索验证编译通过 → 再 `create_job`（编译通过才创建）。

**本地非 git 仓库前置（2026-11-12 会话 ed0ef1ff 实测）**：`repo_prepare` 只建远程仓、不 init 本地 git；`repo_push` 有 `not_git_repo` 预检——本地目录缺 `.git` 时先经宿主命令初始化：`git init; git config user.email "<邮箱>"; git config user.name "<用户名>"; git add .; git commit -m "initial commit"`（**PowerShell 5.1 不支持 `&&`，命令用 `;` 分隔或逐条执行**——会话中模型复制 `&&` 链命令撞 `&&不是此版本中的有效语句分隔符`；`repo_push` 的 `not_git_repo` next_actions 已含此指引），再 `repo_push`。

**推码凭据规约（FE-15 §2.1）**：`repo_push` 失败后转用宿主命令（pwsh/bash）手动推送时，**必须先调 `get_push_credential` 取 token + authedUrl + 可执行命令**——禁止凭记忆自行拼 URL（曾 `oauth2:`/裸 token/`AK:SK` 拼接均实测被拒 CH.00905401）。`get_push_credential` 返回的 `commands` 字段含可直接复制的命令（含 token URL），复制即可用。token 来源链：显式 accessToken > env `CAB_CODEARTSREPO_TOKEN` > `.dsh-codearts` 文件的 `CAB_CODEARTSREPO_TOKEN` 键。

**字段串联（FE-12 P3）**：`repo_prepare` 输出的 `remote_url`/`repo_id`/`url` 是下游唯一输入来源——`repo_push` 的 `remoteUrl` 参数**直接取 repo_prepare 输出的 `remote_url`**（缺省时 repo_push 会从本地 codehub 远端自动探测，标注 `remote_url_source: detected`）；`create_job` 的 `scms.repo_id/url` 取 `repo_prepare` 输出的 `repo_id/url`。

**create_job 自动查重 + 模板化创建**：`create_job` 工具自动查重（命中同名 → E_PARAM 引导改名创建）+ 校验 scm 来源。传 `stepsPlan` 定义**步骤顺序 + 每步参数**（如 `[{step:"maven-build",properties:{command:"mvn clean package"}},{step:"upload-release",properties:{file:"target/*.jar"}}]`）；组合表见 references/language-combinations.md（**TS/JS/Node → 用 npm 环境锚点**）。

**产物交付（FE-12 P4）**：`list_artifacts` 为空时，检查任务 steps 是否含 `upload-release`（上传软件包到发布库）/`upload-obs`/`build-image-swr`——references/language-combinations.md 组合表中的组合已含 `upload-release`；用户手拼 steps 时若需交付产物，记得补对应上传步骤，否则构建成功但产物不交付。

### 意图 2：仅本地构建探索（验证能否编译）

```
用户：这个仓库能编译吗？产物是什么
subagent(本地构建探索, 返回 build info JSON)
（子 agent 自主探索跑通编译，输出 build info：环境/命令/产物）
```

详细见 references/local-build-explorer.md。

### 意图 3：仅云端已有任务（不本地构建）

```
用户：把已有任务A跑一下
 get_job(A) → run_job → wait_build → list_artifacts
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
get_status（单次）
```

### 意图 6：查询历史与产物

```
用户：昨天的构建结果和产物
get_record → list_artifacts
```

### 意图 7：构建失败诊断

```
用户：构建任务A失败了，帮我看看原因
get_record(取 record_id) → get_log → 日志清洗 → LLM 分析根因
    → 给出修复建议 → 修复后重试 run_job | 无果升级用户
```

（清洗输出结构、错误分类表、脱敏见 references/local-build-and-log.md）

### 意图 8：配置管理

```
用户：改一下任务的构建配置 / 清理废弃任务
get_job → update_job（改配置）
list_jobs → delete_job（须确认后删）
```

## 配置（dsh 插件）

前置依赖：凭据已配置。`credentialSource` 支持两种来源——`env`（设置 `CAB_AK`/`CAB_SK`/`CAB_REGION`）、`file`（工作目录 `.dsh-codearts` 文件）；缺省自动探测（CAB_AK → env；cwd 有 `.dsh-codearts` → file）。凭据配置缺失时按优先级提示用户配置后重试。

```yaml
# cordis.patch.yml / profile 装配
plugins:
  - id: codeartsbuild
    name: '@dsh-codearts/codeartsbuild'
    config:
      region: cn-north-4
      # credentialSource: env | file（缺省自动探测：CAB_AK → env；cwd .dsh-codearts → file）
      # proxyUrl: http://proxy.example.com:8080（内网代理，可选）
      # projectId 不在此固定——会话级动态注入（见"数据来源映射"#1：首次用户指定/list_projects 选择，后续自动复用）
```

## 参考

- 语言→步骤组合 / 环境锚点 / module_id 白名单：`references/language-combinations.md`
- 仓库来源路由 / scm 来源强制：`references/repo-source-routing.md`
- git push 链路（repo_push 一次智能尝试 + 失败分类决策树）：`references/git-push.md`
- Step 模板清单（默认 properties）：`references/step-templates.md`
- 本地构建探索子 agent（FE-14：prompt 模板 + 输出 schema + 探索流程）：`references/local-build-explorer.md`
- 日志清洗：`references/local-build-and-log.md`
- [CodeArts Build API 参考](https://support.huaweicloud.com/api-codeci/cloudbuild_03_0000.html)
