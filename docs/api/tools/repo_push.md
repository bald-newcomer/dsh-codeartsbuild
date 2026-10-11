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
| **描述** | 将本地 git 仓库代码推送到 CodeArtsRepo 目标仓库。内置一次智能尝试：自动携带内网代理 + SSL 关闭参数推送；push 前 `git remote -v` 预检 origin 项目归属（≠ projectUuid → `project_mismatch` 不推送）；失败按 stderr 分类（AUTH/SSL/NETWORK/REJECTED_FETCH_FIRST/RUNTIME_CRASH/UNKNOWN），SSL/NETWORK 携参自动重试一次，仍失败输出 `error_type` + `next_actions` 交模型/用户接管 |
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

**内部流程**：

| 步骤 | 操作 | 说明 |
|------|------|------|
| ① 入参校验 | repoPath/projectUuid 必填 + 32 位小写校验 | 非法 → E_PARAM |
| ①' remoteUrl 自动探测（FE-12 P1，2026-10-11） | 缺 remoteUrl → `git remote -v` 探测本地 codehub 远端（优先 origin，其次任一含 codehub/devcloud 远端） | 探测成功 → 用之并标注 `remote_url_source: detected`；探测失败/第三方 URL → `missing_remote_url` 提示先 repo_prepare |
| ② origin 预检 | `git remote -v`（只读）→ 解析 origin URL 项目 UUID（`parseProjectUuidFromRemoteUrl`，HTTPS 路径第 4 段 / SSH 冒号后第 1 段） | origin 项目 UUID ≠ projectUuid → 返回 `project_mismatch:true` + next_actions（set-url 到 remoteUrl / 切换会话 projectId），**不推送**（机制消除本次会话第 1 败：误对旧远端 push） |
| ③ 对齐 origin | 已有 origin 且 ≠ remoteUrl → `git remote set-url origin <remoteUrl>`；无 origin → `git remote add origin <remoteUrl>` | 确保推送目标正确 |
| ④ 首次推送 | `git -c http.proxy=<proxy> -c http.sslVerify=<bool> push -u origin <branch>`（spawn, shell, 超时 SIGKILL, 尾部截断） | 自动携带内网三要素中的代理 + SSL（机制消除第 2 败） |
| ⑤ 失败分类 | stderr 正则分类（AUTH/SSL/NETWORK/REJECTED_FETCH_FIRST/RUNTIME_CRASH/UNKNOWN） | SSL/NETWORK → 自动重试一次；其余不重试 |
| ⑥ 输出 | `pushed` + `retry_applied` + `error{error_type, message, process_hint}` + `next_actions[]` | 交模型/用户按 next_actions 接管 |

**错误分类表**（stderr 特征 → error_type → 行为）：

| error_type | stderr 特征 | repo_push 行为 | next_actions 示例 |
|------------|-------------|----------------|-------------------|
| `AUTH` | `Authentication failed` / `Permission denied` / `access denied` / `401` | 不自动重试（凭据非参数可解） | 配置 HTTPS 访问令牌 / SSH 密钥后重试 |
| `SSL` | `self-signed certificate` / `SSL certificate` / `sslVerify` | **自动携 `http.sslVerify=false` 重试一次** | 重试仍失败 → 检查代理 |
| `NETWORK` | `Connection timed out` / `Could not resolve host` | **自动重试一次** | 确认内网代理可达后重试 |
| `REJECTED_FETCH_FIRST` | `rejected (fetch first)` / `failed to push some refs` | 不自动重试 | `git fetch origin && git rebase origin/<branch>` |
| `RUNTIME_CRASH` | 非零退出 + `CreateFileMapping`/空 stderr（Git for Windows 崩溃） | 不自动重试 | 升级 git / 重装 Git for Windows / 转用户人工推送 |
| `UNKNOWN` | 兜底 | 不自动重试 | 人工检查输出后重试 |

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
| origin 项目 UUID ≠ projectUuid | `project_mismatch:true`，不推送，next_actions 给 set-url / 切换项目指引 |
| 缺少 remoteUrl | 返回 `pushed:false` + reason: `missing_remote_url`，提示先 `repo_prepare` |
| 非 git 仓库 / 无 origin | 忽略 remote -v 失败，走 remote add |
| push 失败 | **不抛异常**：返回结构化 `pushed:false` + error + next_actions（push 失败不阻断 create_job 前置，对齐 repo-source-routing §6） |
| projectUuid 非法 / repoPath 缺失 | E_PARAM |
| git 命令超时 | E_TIMEOUT |

**SKILL 编排**：意图 1 路由 `repo_prepare → repo_push → repo_build → create_job`；失败分类决策树见 `skills/codeartsbuild/references/git-push.md`。
