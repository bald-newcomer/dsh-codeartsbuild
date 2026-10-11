# 仓库来源路由 + scm 来源强制（create_job 前置链路）

> 对应 SKILL.md「建议操作路径：意图 1」与「强制规约 #7」的展开。创建任务前必须先走本路由确定仓库类型与 scm 来源。

## 0. 核心原则

- **create_job.scms 字段必须取自正确前置渠道**（本地远端解析 / 远端克隆或建仓实际返回 / 已有任务回读），**禁止臆造**（gitlab/github 等未实测类型、第三方 Git URL、凭空拼 repo_id）。
- **来源不明 → 转人工确认**，不得臆造后重试。
- **重试上限 3 轮**：create_job 同一错误累计 >3 轮必须转人工求助，不得无限改参硬试。

## 1. 仓库类型判定（create_job 前）

```
[确定仓库类型]
  本地仓库: 检测 git remote -v
    ├─ 已有 codehub 远端 → 走「已有远端」分支（§2.2）
    └─ 无远端 / 纯本地 → repo_prepare 建仓（§2.1）
  远端 codehub 仓库: git clone 到本地 → repo_build 验证编译通过 → create_job（§2.3）
```

## 2. 分支流程

### 2.1 本地仓库（无远端）→ repo_prepare 建仓

1. `repo_prepare(repoPath, projectUuid)` 建仓 + 回读 RepoInfo，返回 `repo_id/url/web_url` + `remote_url` + `push_guidance`。
2. **git push 由 `repo_push` 工具执行**（内置一次智能尝试：代理+SSL 自动携带、origin 项目归属预检、失败分类输出 next_actions，见 git-push.md）。仅 AUTH/RUNTIME_CRASH 等无法自动化解的失败，模型才接管用宿主命令工具或升级用户。
3. `repo_build` 验证编译通过。
4. `create_job`（scm 取 repo_prepare 返回的 RepoInfo）。

**字段串联表（FE-12 P3，2026-10-11）**——`repo_prepare` 输出是下游唯一输入来源：

| 下游工具 | 参数 | 来源（强制） |
|----------|------|--------------|
| `repo_push.remoteUrl` | 推送远端地址 | `repo_prepare` 输出的 `remote_url`（缺省时 repo_push 自动探测本地 codehub 远端，标注 `remote_url_source: detected`） |
| `create_job.scms.repo_id` | 仓库数字主键 | `repo_prepare` 输出的 `repo_id` |
| `create_job.scms.url` | 仓库克隆地址 | `repo_prepare` 输出的 `url` |
| `create_job.scms.web_url` | 控制台页面 | `repo_prepare` 输出的 `web_url` |

禁止手拼/从别处猜测；来源不明转人工确认。

### 2.2 本地仓库（已有 codehub 远端）

1. `repo_prepare` 会**自动回读 repo_id**（经 ListRepositoryByProject + GetRepository 解析远端仓库名 → repoId）。
2. **scm 必须取 repo_prepare 输出的 repo_id**。
3. 若输出 `repo_id:null`（自动解析未命中）→ 经 `get_job`/`list_jobs` 已有任务回读 scm，或向用户要 repo_id，**禁止用 URL 当 repo_id**。
4. 若需推送代码到远端：`repo_push`（origin 预检会拦截跨项目 origin——origin 项目 UUID ≠ 目标 projectUuid 时返回 `project_mismatch:true` 不推送）。
5. `repo_build` 验证 → `create_job`。

### 2.3 远端 codehub 仓库

1. 先 `git clone <repo_url> -b <branch>` 到本地工作目录。
2. `repo_build` 验证编译通过（**编译通过才创建**）。
3. `create_job`（scm 取克隆/建仓实际返回的 repo_id/url）。

## 3. scm 字段来源强制表

| scm 字段 | 来源渠道（强制） | 是否可臆造 |
|----------|------------------|-----------|
| `scm_type` | 实测唯一的 `codehub`；其它枚举（gitee/github/gitlab 等）**未实测，禁用** | ❌ 禁止 |
| `repo_id` | ① CodeArtsRepo 建仓返回 ② `get_job`/`list_jobs` 已有任务回读 ③ 本地已有远端仓库解析（repo_prepare 自动回读） | ❌ 禁止 |
| `repo_name` | 建仓返回 / 已有任务回读 | ❌ 禁止 |
| `url` | CodeArtsRepo 仓库 URL（建仓/回读），**非**第三方 Git 平台 URL | ❌ 禁止 |
| `web_url` | 建仓返回 / 已有任务回读 | ❌ 禁止 |
| `branch` | 用户指定 / 默认分支 | ✅ 可默认（master/main） |
| `build_type` | 默认，留空 | ✅ |

**仓库信息字段映射**（repo_prepare 返回 → scm）：

| create_job.scms 字段 | CodeArtsRepo RepoInfo 字段 |
|---------------------|----------------------------|
| `scm_type` | 固定 `codehub` |
| `repo_id` | RepoInfo.`repoId`（**数字主键**，如 `2673623`，非 UUID `id`） |
| `repo_name` | RepoInfo.`name` |
| `url` | RepoInfo.`httpUrl`（HTTPS 克隆地址） |
| `web_url` | RepoInfo.`webUrl`（控制台页面地址） |

## 4. 项目选择（2026-09-29 决策；2026-10-09 对齐 SKILL 强制规约 #7 项目隔离）

- **目标项目固定为会话 projectId**：`repo_prepare` 的 `projectUuid` 入参取会话上下文 projectId；建仓/查仓/创建任务/查历史等所有操作均在当前项目内进行，**禁止跨项目**（SKILL 强制规约 #7）。
- **远端 URL 项目归属仅作机制层校验**：`repo_prepare` 检测远端 URL 项目归属 ≠ 入参 `projectUuid` 时，返回结果附加 `project_mismatch:true` + `remote_project_uuid` + `mismatch_hint` 警告——看到此字段应向用户确认：是否切换到远端 URL 所属项目（切换须用户显式确认并刷新会话 projectId），或在当前项目新建仓库。
- **切换项目须用户显式确认**：不得自行跨项目建仓/查仓/创建任务；需操作其他项目时，先向用户确认并刷新会话 projectId 后再操作。

## 5. create_job 失败回溯

`create_job` 报"仓库不存在（422）"/"repo_id 必填"时，**停止重试**，按 §3 回溯 scm 来源渠道；同一错误累计 **>3 轮必须转人工求助**，不得无限改参硬试。

## 5.1 create_job 前任务名查重（2026-10-10 实测）

创建任务前先用 `list_jobs(search=拟用任务名)` 查重——项目下任务名已存在时服务端返回 422 `DEVCB.00031075 项目下任务名称已存在`（实测）。有同名任务时：经用户确认复用/改名（`-v2` 等后缀），或直接 `update_job` 修改已有任务，**不重复新建**。

## 6. push 失败不阻断

仓库已建 + RepoInfo 已返回，`create_job` 前置已完成——可继续用 RepoInfo 创建任务，同时向用户说明推送失败原因与处理建议。推送执行与失败分类统一走 `repo_push`（git-push.md 决策树）。

## 7. create_job scms 项目一致性（2026-10-10 机制层）

`create_job` 校验 `scms[].url` 解析出的项目 UUID ≠ 会话 projectId 时返回 `E_PARAM`（禁止跨项目建仓/建任务）。组装 scm 时确保 url 取自 `repo_prepare` 建仓返回 / `get_job` 回读（同一项目内），不要混用其他项目的仓库 URL。
