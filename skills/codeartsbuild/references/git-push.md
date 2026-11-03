# git push 链路契约（repo_prepare 之后的推送执行）

> `repo_prepare` **不做 git push**——推送由 **`codeartsbuild_repo_push` 工具**执行（内置一次智能尝试），仅当工具报 AUTH / RUNTIME_CRASH 等无法自动化解的失败时，模型才接管用宿主命令工具（bash/pwsh）或升级用户。远端地址取 `repo_prepare` 输出的 `remote_url`（HTTPS）或 `ssh_url`（SSH）。

## 1. 内网 git 访问 codehub 的三要素（实测必需，缺一不通）

1. **代理**：`http.proxy=http://proxycn2.huawei.com:8080`（或用户环境代理）
2. **SSL 关闭**：`http.sslVerify=false`（内网自签名证书链）
3. **凭据**：HTTPS 需访问令牌或 git credential manager 缓存（认证 401 时提示用户配置）

**`repo_push` 已自动携带前两项**（`-c http.proxy=... -c http.sslVerify=false`，可用入参 `proxyUrl`/`sslVerify` 覆盖）。

> **✅ 凭据机制化（FE-15，2026-10-23 会话 63534983）**：`repo_push` 的 `accessToken` 来源链——**显式入参 > 环境变量 `CAB_CODEARTSREPO_TOKEN` > `.dsh-codearts` 文件的 `CAB_CODEARTSREPO_TOKEN` 键**（key=value 行格式，如 `.dsh-codearts` 已含 `CAB_AK=...` 则追加一行 `CAB_CODEARTSREPO_TOKEN=<令牌>`）。用户把令牌写入任一处后，**工具自动构造并注入** `https://private-token:<TOKEN>@codehub...` 一次性 push URL（`git -c remote.origin.url` 进程级覆盖，**不写盘/不改 origin 配置/不进输出**）。模型**禁止用宿主命令拼凭据 URL**。未提供 accessToken 且本地无凭据（URL 未内嵌 user:pass / 未配 credential.helper）时，`repo_push` 返回 `reason:missing_credentials` 引导用户提供——模型不得盲目重试撞认证失败。

> **⚠️ 凭据禁止用 AK/SK 拼接 URL**（2026-10-10 实测）：`CAB_AK`/`CAB_SK` 仅用于云侧 API 签名，**不得**拼进 git 远端地址（`https://AK:SK@codehub...`）当 push 凭据——实测返回 `CH.00905401 HTTP Basic: Access denied`。git push 认证只认访问令牌 / SSH 密钥。

> **ℹ️ HTTPS 访问令牌的用户名固定为 `private-token`**（2026-10-15 实测，会话 58dccf5f）：工具注入时自动使用，**模型无需也不应手动拼**。错误形式（均实测被拒 `CH.00905401`）：裸 token 拼接（`https://<TOKEN>@codehub...`）、`oauth2:<TOKEN>` 形式、`AK:SK` 拼接。

## 1.1 repo_push 缺 remoteUrl 自动探测（FE-12 P1，2026-10-11）

`repo_push` 未传 `remoteUrl` 时会**自动从本地 git 远端探测** codehub 仓库地址（优先 origin，其次任一含 codehub/devcloud 的远端），返回结果标注 `remote_url_source: detected`。**注意**：探测自本地 origin 时，若尚未 `repo_prepare` 建仓，先确认该仓库存在再推——探测是兜底，正常流程仍应传 `repo_prepare` 输出的 `remote_url`。

## 1.2 宿主 git 安全操作（FE-12 P2，2026-10-11 8155dd01 实测）

模型用宿主命令（bash/pwsh）执行 git 时：

- **禁止破坏性命令**：`git reset --hard` / `git checkout -- .` / `git clean -f`——会丢弃工作区/未提交变更（曾 `reset --hard` 致 `src/` 丢失靠 reflog 自救）。撤销变更用 `git stash` / `git checkout -- <具体文件>`（指向性恢复）。
- **push 前确认**：`git status` 确认工作区干净；本地领先 origin 直接 push；分歧用 `git pull --rebase`（不用 merge 避免多余合并提交）。
- **失败先验证再 panic**：`exit code 1` 可能是 msys DLL 噪音（`CreateFileMapping` 等）而命令实际成功——先 `git log`/`git status` 确认实际效果，再判断是否真失败。
- **rebase --continue 前必须设非交互编辑器**（2026-10-15 会话 58dccf5f 实测）：Git for Windows **不支持 `--no-edit`**（`unknown option 'no-edit'`）；裸 `git rebase --continue` 会拉起 vim，在 PowerShell 非交互窗口**挂起**。正确做法：`$env:GIT_EDITOR='true'; git rebase --continue`（或 `git -c core.editor=true rebase --continue`）。
- **命令串残留排查**（2026-10-15 会话 58dccf5f 实测）：报 `Unrecognized command or argument 'store'` 时先检查远端 URL / `~/.gitconfig` / 命令串是否残留损坏参数（本会话 `credential.helper` 残留 `store` 污染了后续所有 push）——**修正命令而非在同一命令串上盲目重试**。

## 2. 建仓后服务端初始提交（无共同祖先）

`repo_push` 失败分类 `REJECTED_FETCH_FIRST` 时按 next_actions 处理：

```bash
git fetch origin
git rebase origin/master
# README 可能 add/add 冲突 → 取本地
git checkout --ours README.md
git push -u origin <branch>
```

## 3. repo_push 失败分类决策树（工具输出 error_type → 模型/用户处理）

| error_type | stderr 特征 | repo_push 行为 | 模型/用户处理 |
|------------|-------------|----------------|---------------|
| `missing_credentials`（reason） | 无 accessToken 且本地无凭据（URL 未内嵌 / 未配 credential.helper） | **推送前预检拦截，不执行 push**（FE-15） | 提示用户提供访问令牌，携带 `accessToken` 参数重试；或配 SSH 密钥 |
| `PROXY_AUTH` | `CONNECT tunnel failed.*407` / `407.*Proxy Authentication Required` | 不自动重试（代理需 NTLM 认证，`http.proxy` 不通） | **用宿主命令推送（系统代理自动处理 NTLM）**——next_actions 已给含 token URL 的可执行命令，复制即可用，勿自行拼 URL |
| `AUTH` | `Authentication failed` / `Permission denied` / `401` | 不自动重试（凭据非参数可解） | 提示用户提供访问令牌，携带 `accessToken` 参数重试 repo_push（工具自动注入 private-token，勿宿主拼 URL）；或 SSH 密钥 |
| `SSL` | `self-signed certificate` / `SSL certificate` | **自动携 `http.sslVerify=false` 重试一次** | 重试仍失败 → 检查代理配置 |
| `NETWORK` | `Connection timed out` / `Could not resolve host` | **自动重试一次** | 确认内网代理可达（`-c http.proxy=<代理>`）后重试 |
| `REJECTED_FETCH_FIRST` | `rejected (fetch first)` / `failed to push some refs` | 不自动重试 | 按 §2 fetch+rebase 处理 |
| `RUNTIME_CRASH` | 非零退出 + `CreateFileMapping`/空 stderr（Git for Windows 崩溃） | 不自动重试 | 升级 git / 重装 Git for Windows 后重试，或转用户人工推送 |
| `UNKNOWN` | 兜底 | 不自动重试 | **next_actions 已给含 token URL 的可执行宿主命令**（有 token 时）——模型转 pwsh 时复制即可用，勿自行拼 URL；无 token 时提示用户提供 |

- `repo_push` 输出 `pushed:false` + `next_actions[]` 时，模型按 next_actions 接管或升级用户。
- **转用宿主命令（pwsh/bash）手动推送前，必须先调 `get_push_credential` 取 token + authedUrl + 可执行命令**（返回的 `commands` 字段含可直接复制的命令）——禁止凭记忆自行拼 URL（FE-15 §2.1）。
- **重试上限 3 轮**，无果升级用户。
- **push 失败不阻断**：仓库已建 + RepoInfo 已返回，可继续用 RepoInfo 创建任务，同时向用户说明推送失败原因与处理建议。
