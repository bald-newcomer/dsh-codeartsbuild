# 工具契约 — codeartsbuild_get_push_credential

> **来源**: `docs/api/api-contract.md` §2.19（工具接口契约，唯一事实来源）
> **设计依据**: FE-15-凭据机制化与规约下沉设计-20261026.md §2.1（凭据机制化）、`skills/codeartsbuild/references/git-push.md`（推送凭据规约）
> **2026-10-28 引入**: 会话 1d8dc38a 实测——`repo_push` 失败后模型转用 pwsh 手动推送时无法复用已配置令牌，遂自行拼 URL（`oauth2:`/裸 token/`AK:SK` 均被拒 CH.00905401）

### 2.19 codeartsbuild_get_push_credential

获取 CodeArtsRepo 推送凭据：解析令牌 → 构造 `private-token` 认证 URL → 返回可直接复制的命令示例。**供模型在 `repo_push` 失败后转用宿主命令（pwsh/bash）推送时复用凭据，禁止自行拼 URL**。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_get_push_credential` |
| **场景** | B. 本地构建域（仓库推送，`repo_push` 失败接管） |
| **描述** | 按来源链解析访问令牌（显式入参 > 环境变量 `CAB_CODEARTSREPO_TOKEN` > `.dsh-codearts` 文件同名键），构造 `https://private-token:<TOKEN>@codehub...` 认证 URL，返回 `authed_url` + `commands`（可直接执行的 git 命令）。**未配置令牌时返回 `available:false + reason:no_token` 引导用户提供**，不回显任何令牌 |
| **承载** | 纯本地计算（无云侧 HTTP、无 git 子进程调用） |
| **前置** | 已知目标远端地址（取 `repo_prepare` 输出的 `remote_url`） |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| remoteUrl | string | ✅ | 目标 codehub 远端地址（构造 `authed_url` 用；取 `repo_prepare` 输出的 `remote_url`） |
| accessToken | string | ❌ | CodeArtsRepo HTTPS 访问令牌（优先级最高，覆盖 env/`.dsh-codearts`）。令牌由用户提供，模型不得臆造 |

**内部流程**：

| 步骤 | 操作 | 说明 |
|------|------|------|
| ① 入参校验 | `remoteUrl` 非空 | 空 → `available:false + reason:missing_remote_url` |
| ② 解析令牌 | `resolveAccessToken(accessToken)`（与 `repo_push` 共用实现） | 显式入参 > env `CAB_CODEARTSREPO_TOKEN` > `.dsh-codearts` 文件同名键；均无 → `available:false + reason:no_token` + 引导 |
| ③ 构造认证 URL | `buildAuthedUrl(remoteUrl, token)`：用户名固定 `private-token`，密码为令牌 | URL 解析失败（SSH 地址等）→ 原样返回，由调用方判断 |
| ④ 输出 | `available` + `remote_url` + `authed_url` + `username` + `commands` + `hint` | `commands` 含 `set_url_and_push` / `direct_push` 两条可直接复制的命令 |

**输出示例**（已配置令牌）：

```json
{
  "available": true,
  "remote_url": "https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git",
  "authed_url": "https://private-token:<TOKEN>@codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git",
  "username": "private-token",
  "commands": {
    "set_url_and_push": "git remote set-url origin <authed_url> && git -c http.sslVerify=false push -u origin master",
    "direct_push": "git -c http.sslVerify=false push <authed_url> master"
  },
  "hint": "已配置 accessToken——以上命令可直接用于 pwsh/bash，无需自行拼 URL。token 来源：显式入参 > env CAB_CODEARTSREPO_TOKEN > .dsh-codearts 文件"
}
```

**输出示例**（未配置令牌）：

```json
{
  "available": false,
  "reason": "no_token",
  "remote_url": "https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/demo.git",
  "hint": "未配置 accessToken——请用户提供 CodeArtsRepo 访问令牌后，携带 accessToken 参数重试，或写入 .dsh-codearts 的 CAB_CODEARTSREPO_TOKEN 键"
}
```

**边界与错误**：

| 场景 | 行为 |
|------|------|
| `remoteUrl` 缺失/空串 | `available:false + reason:missing_remote_url`（非异常） |
| 无任何令牌来源 | `available:false + reason:no_token` + 引导用户提供，不抛异常 |
| `remoteUrl` 非可解析 URL（SSH 形式） | `authed_url` 原样返回 `remote_url`，由调用方回退 SSH 通道 |
| 令牌回显 | **绝不回显 token 明文以外的形式**——`authed_url`/`commands` 中按需含令牌（模型需拼入命令），`_summary` 不含 |

**安全约束**：

- **令牌不写入磁盘**：仅拼入返回值，不修改 `.git/config`、不落日志。
- **模型禁止自行拼 URL**：`repo_push` 失败转宿主命令前必须先调本工具（`oauth2:`/裸 token/`AK:SK` 拼法均实测被拒 `CH.00905401`）。
- **`CAB_AK`/`CAB_SK` 不得用作 push 凭据**：仅用于云侧 API 签名。

**SKILL 编排**：`repo_push` 返回 `pushed:false` 且需转宿主命令时 → `get_push_credential(remoteUrl)` → 复制返回的 `commands` 执行；决策树见 `skills/codeartsbuild/references/git-push.md`。