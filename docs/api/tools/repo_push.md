# 工具契约 — codeartsbuild_repo_push

> **来源**: `docs/api/api-contract.md` §2.18（工具接口契约，唯一事实来源）
> **设计依据**: FE-08-本地远端仓库方案探索-20260923.md §5（形态 B：内置一次智能尝试，2026-10-10 用户决策）
> **前身**: 2026-09-28 曾将原 `repo_push` 瘦身改名 `repo_prepare`（push 由模型自探索）；2026-10-10 实测（docs/example/session.jsonl）证明模型自探索 push 三连败（origin 跨项目 / SSL / Git for Windows 崩溃）→ 恢复独立推送工具，形态改为**工具内置一次智能尝试 + 失败分类**，复杂凭据/崩溃交模型/用户接管

### 2.18 codeartsbuild_repo_push

推送本地 git 仓库代码到 CodeArtsRepo（`repo_prepare` 建仓之后接续）。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_repo_push` |
| **场景** | B. 本地构建域（仓库推送） |
| **描述** | 将本地 git 仓库代码推送到 CodeArtsRepo 目标仓库。内置一次智能尝试：自动携带内网代理 + SSL 关闭参数推送；push 前 `git remote -v` 预检 origin 项目归属（≠ projectUuid → `project_mismatch` 不推送）；**凭据机制化（FE-15）：提供 `accessToken` 时自动注入 `https://private-token:<TOKEN>@codehub...` 一次性 push URL（`git -c remote.origin.url` 进程级覆盖，不写盘/不进输出）；未提供时预检本地凭据，无凭据 → `missing_credentials` 引导**；失败按 stderr 分类（AUTH/SSL/NETWORK/REJECTED_FETCH_FIRST/RUNTIME_CRASH/UNKNOWN），SSL/NETWORK 携参自动重试一次，仍失败输出 `error_type` + `next_actions` 交模型/用户接管 |
| **承载** | git 客户端本地执行（spawn, shell），无需云侧 HTTP |
| **前置** | `repo_prepare` 已建仓并返回 `remote_url`/`repo_id`；本地 git 仓库存在 |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| repoPath | string | ✅ | 本地 git 仓库绝对路径 |
| projectUuid | string | ✅ | 目标项目 UUID（32 位小写数字字母，= 会话 projectId） |
| repoName | string | ❌ | 仓库名（默认取目录名，仅诊断提示） |
| branch | string | ❌ | 推送分支（默认 master） |
| remoteUrl | string | ❌ | 目标 codehub 远端地址（默认取 repo_prepare 输出 `remote_url`） |
| proxyUrl | string | ❌ | 内网代理（默认 `http://proxycn2.huawei.com:8080`，可被环境覆盖） |
| sslVerify | boolean | ❌ | 是否关闭 SSL 校验（默认 false=内网自签名证书，`git -c http.sslVerify=false`） |
| accessToken | string | ❌ | CodeArtsRepo HTTPS 访问令牌（FE-15）。提供时工具自动构造 `https://private-token:<TOKEN>@codehub...` 一次性 push URL（`git -c remote.origin.url` 进程级覆盖，**不写盘/不改 origin 配置/不进输出**）。令牌由用户提供，模型不得臆造。**来源链：显式 accessToken > 环境变量 `CAB_CODEARTSREPO_TOKEN` > `.dsh-codearts` 文件的 `CAB_CODEARTSREPO_TOKEN` 键**（key=value 行格式） |

**内部流程**：

| 步骤 | 操作 | 说明 |
|------|------|------|
| ① 入参校验 | repoPath/projectUuid 必填 + 32 位小写校验 | 非法 → E_PARAM |
| ①.25 非 git 仓库预检（FE-13 §2.2，2026-10-16） | `git rev-parse --git-dir` 探测本地是否 git 仓库 | 非 git 仓库 → `pushed:false + reason:not_git_repo + next_actions:[git init 指引]`，**不撞 UNKNOWN**（会话 58dccf5f：本地无 .git 时旧实现吞 remote -v 失败致 push 撞 UNKNOWN） |
| ①' remoteUrl 自动探测（FE-12 P1，2026-10-11） | 缺 remoteUrl → `git remote -v` 探测本地 codehub 远端（优先 origin，其次任一含 codehub/devcloud 远端） | 探测成功 → 用之并标注 `remote_url_source: detected`；探测失败/第三方 URL → `missing_remote_url` 提示先 repo_prepare |
| ② origin 预检 | `git remote -v`（只读）→ 解析 origin URL 项目 UUID（`parseProjectUuidFromRemoteUrl`，HTTPS 路径第 4 段 / SSH 冒号后第 1 段） | origin 项目 UUID ≠ projectUuid → 返回 `project_mismatch:true` + next_actions（set-url 到 remoteUrl / 切换会话 projectId），**不推送**（机制消除本次会话第 1 败：误对旧远端 push） |
| ③ 对齐 origin | 已有 origin 且 ≠ remoteUrl → `git remote set-url origin <remoteUrl>`；无 origin → `git remote add origin <remoteUrl>` | 确保推送目标正确 |
| ③.75 认证预检（FE-15 §2.2，2026-10-23 会话 63534983） | 无 accessToken → 探测本地凭据（remote/origin URL 内嵌 `user:pass` / `credential.helper` 已配置） | 均无 → `pushed:false + reason:missing_credentials + next_actions:[引导用户提供 accessToken]`，**不盲目撞 AUTH**（会话 63534983：模型无凭据硬推撞认证失败） |
| ④ 首次推送 | `git -c http.proxy=<proxy> -c http.sslVerify=<bool> [-c remote.origin.url=https://private-token:<TOKEN>@codehub...] push -u origin <branch>`（spawn, shell, 超时 SIGKILL, 尾部截断） | 自动携带内网三要素中的代理 + SSL（机制消除第 2 败）；accessToken 提供时凭据注入 |
| ⑤ 失败分类 | stderr 正则分类（AUTH/SSL/NETWORK/REJECTED_FETCH_FIRST/RUNTIME_CRASH/UNKNOWN） | SSL/NETWORK → 自动重试一次；其余不重试 |
| ⑥ 输出 | `pushed` + `retry_applied` + `error{error_type, message, process_hint}` + `next_actions[]` | 交模型/用户按 next_actions 接管 |

**错误分类表**（stderr 特征 → error_type → 行为）：

| error_type | stderr 特征 | repo_push 行为 | next_actions 示例 |
|------------|-------------|----------------|-------------------|
| `AUTH` | `Authentication failed` / `Permission denied` / `access denied` / `401` | 不自动重试（凭据非参数可解） | 配置 HTTPS 访问令牌 / SSH 密钥后重试 |
| `PROTECTED_BRANCH` | `protected branch` / `cannot force push` / `refusing to push.*protected` | 不自动重试（-f 已被服务端拒） | 走 `git pull --rebase origin <branch>` 后 `git push`（非 `-f`），或联系管理员开临时强推权限（FE-16 §2.3） |
| `SSL` | `self-signed certificate` / `SSL certificate` / `sslVerify` | **自动携 `http.sslVerify=false` 重试一次** | 重试仍失败 → 检查代理 |
| `NETWORK` | `Connection timed out` / `Could not resolve host` | **自动重试一次** | 确认内网代理可达后重试 |
| `REJECTED_FETCH_FIRST` | `rejected (fetch first)` / `failed to push some refs` | 不自动重试 | `git fetch origin && git rebase origin/<branch>` |
| `RUNTIME_CRASH` | 非零退出 + `CreateFileMapping`/空 stderr（Git for Windows 崩溃） | 不自动重试 | 升级 git / 重装 Git for Windows / 转用户人工推送 |
| `PROXY_AUTH` | `CONNECT tunnel failed.*407` / `407.*Proxy Authentication Required` | 不自动重试（代理需 NTLM 认证，`http.proxy` 不通） | 转宿主命令推送（系统代理自动处理 NTLM），next_actions 给含 token URL 的可执行命令 |
| `UNKNOWN` | 兜底 | 不自动重试 | 人工检查输出后重试；有 token 时 next_actions 给可执行宿主命令 |

**输出示例**（成功）：

```json
{
  "pushed": true,
  "remote_url": "https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git",
  "branch": "master",
  "repo_name": "demo",
  "retry_applied": false
}
```

**输出示例**（失败，SSL 重试仍败）：

```json
{
  "pushed": false,
  "remote_url": "https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git",
  "branch": "master",
  "repo_name": "demo",
  "retry_applied": true,
  "error": { "error_type": "SSL", "message": "SSL certificate ... self-signed certificate in certificate chain (19)", "process_hint": "..." },
  "next_actions": ["检查代理配置后重试：git -c http.sslVerify=false -c http.proxy=<代理> push -u origin master"]
}
```

**边界与错误**：

| 场景 | 行为 |
|------|------|
| 本地非 git 仓库 | `pushed:false + reason:not_git_repo` + next_actions（git init 指引），不撞 UNKNOWN（FE-13 §2.2） |
| 本地当前分支 ≠ 入参 branch | `pushed:false + reason:branch_mismatch + current_branch` + next_actions（确认推送 current 还是切到 branch），不误推到非预期分支（FE-16 §2.3） |
| push -f 撞受保护分支 | `pushed:false + error.error_type:PROTECTED_BRANCH` + next_actions（走 `pull --rebase` 非 `-f`，或联系管理员开临时强推），不自动重试（FE-16 §2.3） |
| 无 accessToken 且本地无凭据 | `pushed:false + reason:missing_credentials` + next_actions（引导提供 accessToken / 配 SSH），不撞 AUTH（FE-15 §2.2） |
| origin 项目 UUID ≠ projectUuid | `project_mismatch:true`，不推送，next_actions 给 set-url / 切换项目指引 |
| 缺少 remoteUrl | 返回 `pushed:false` + reason: `missing_remote_url`，提示先 `repo_prepare` |
| 非 git 仓库 / 无 origin | 忽略 remote -v 失败，走 remote add |
| push 失败 | **不抛异常**：返回结构化 `pushed:false` + error + next_actions（push 失败不阻断 create_job 前置，对齐 repo-source-routing §6）；转宿主命令前先调 [`get_push_credential`](get_push_credential.md)（§2.19）取凭据 |
| projectUuid 非法 / repoPath 缺失 | E_PARAM |
| git 命令超时 | E_TIMEOUT |

**SKILL 编排**：意图 1 路由 `repo_prepare → repo_push → subagent(本地构建探索) → create_job`；失败分类决策树见 `skills/codeartsbuild/references/git-push.md`。失败后转宿主命令（pwsh/bash）推送前，先调 `get_push_credential`（§2.18）取 `authed_url` + `commands`，禁止自行拼 URL。
