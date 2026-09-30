# git push 链路契约（repo_prepare 之后的推送执行）

> `repo_prepare` **不做 git push**——推送由模型用**宿主命令工具**（bash/pwsh）执行，远端地址取 `repo_prepare` 输出的 `remote_url`（HTTPS）或 `ssh_url`（SSH）。本文档给出内网访问 codehub 的实测必需要素与失败诊断决策树。

## 1. 内网 git 访问 codehub 的三要素（实测必需，缺一不通）

1. **代理**：`git -c http.proxy=http://proxycn2.huawei.com:8080`（或 `git config http.proxy <代理>`）
2. **SSL 关闭**：`git -c http.sslVerify=false`（内网自签名证书链）
3. **凭据**：HTTPS 需访问令牌或 git credential manager 缓存（认证 401 时提示用户配置）

**推荐命令**：

```bash
git -c http.proxy=<代理> -c http.sslVerify=false push origin <branch>
```

## 2. 建仓后服务端初始提交（无共同祖先）

建仓后远端常有服务端初始提交（无共同祖先）——push 报 `rejected (fetch first)`：

```bash
git fetch origin
git rebase origin/master
# README 可能 add/add 冲突 → 取本地
git checkout --ours README.md
git push -u origin <branch>
```

## 3. 失败诊断决策树（读 stderr 分类）

| 失败模式 | stderr 特征 | 处理 |
|----------|-------------|------|
| 认证失败 | `Authentication failed` / `Permission denied` / `access denied` / `401` | 提示用户配置 HTTPS 访问令牌（CodeArts 控制台 → 个人设置 → 代码托管 → 访问令牌）或 SSH 密钥后重试 |
| 网络失败 | `Connection timed out` / `Could not resolve host` | 先试 `-c http.proxy=<代理>`（内网必需），再提示用户检查代理配置 |
| SSL 证书错误 | `self-signed certificate` | 加 `-c http.sslVerify=false` |
| 超时/其他 | — | 重试或升级用户 |

- 重试上限 3 轮，无果升级用户。
- **push 失败不阻断**：仓库已建 + RepoInfo 已返回，可继续用 RepoInfo 创建任务，同时向用户说明推送失败原因与处理建议。
