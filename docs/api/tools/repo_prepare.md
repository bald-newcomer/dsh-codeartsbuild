# 工具契约 — codeartsbuild_repo_prepare

> **来源**: `docs/api/api-contract.md` §2.17（工具接口契约，唯一事实来源）
> **设计依据**: FE-08-本地远端仓库方案探索-20260923.md §5（形态决策：独立工具）+ §1.4（接口实测）
> **2026-09-28 调整**: 原 `repo_push` 瘦身改名——**建仓 + 回读 RepoInfo 保留在工具内；实际 git push 由模型用宿主命令工具（bash/pwsh）自探索**，工具不再内置 push 固定脚本（认证/代理/网络等本地环境差异由模型读 stderr 自行判断决策）

### 2.17 codeartsbuild_repo_prepare

本地仓库准备 CodeArtsRepo 仓库（检测远端 → 无远端时建仓 → 回读仓库信息），返回 RepoInfo + 远程 URL + 推送指引，供 `create_job.scms` 映射。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_repo_prepare` |
| **场景** | B. 本地构建域（仓库准备） |
| **描述** | 将本地 git 仓库准备为 CodeArtsRepo 仓库：检测远端 → 无远端时创建仓库 → 回读 RepoInfo。输出 `repo_id`/`url`/`web_url` 可直接作为 `create_job.scms` 来源；输出 `remote_url`/`push_guidance` 供模型自行执行 `git push` |
| **承载** | 自建 HTTP（AK/SK 签名），`service: 'codeartsrepo'`（`codehub-ext.{region}`） |
| **前置** | 本地已是 git 仓库；项目 UUID（`list_projects` 的 identifier） |

**输入参数**（2026-09-23 实测对齐）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| repoPath | string | ✅ | 本地 git 仓库绝对路径 |
| projectUuid | string | ✅ | 目标项目 UUID（32 位小写数字字母，CodeArtsRepo 建仓 `project_uuid`） |
| repoName | string | ❌ | CodeArtsRepo 仓库名（默认取目录名） |
| branch | string | ❌ | 推送分支（默认 master；push 由模型执行时使用） |

**内部流程**（服务端接口全部 2026-09-23 实调确认）：

| 步骤 | 操作 | 说明 |
|------|------|------|
| ① 检测远端 | `git remote -v`（只读） | 已有 codehub 远端 → **解析远端仓库名 + 项目 UUID**（FE-09 R3 机制层），走 ①' 查仓库，跳过建仓 |
| ①' 目标项目查仓库（2026-09-29 决策） | `GET /v1/projects/{project_uuid}/repositories`（uuid=**入参目标项目**，按 repository_name 命中）→ `GET /v1/repositories/{repository_uuid}`（service=codeartsrepo） | **只查目标项目，不跨项目找**；命中 → 回读 repoId 返回 `existing_remote:true`；未命中（当前项目无此仓库）→ **在当前项目建仓**（走 ②③，允许新建） |
| ①'' project_mismatch 检测（FE-09 R3 2026-09-29 机制层） | 解析远端 URL 中的项目 UUID（HTTPS 路径第 4 段 / SSH 冒号后第 1 段，`[a-f0-9]{32}`），与入参 `projectUuid` 比对 | 不一致 → 返回结果附加 `project_mismatch:true` + `remote_project_uuid` + `mismatch_hint`（警告但不阻断）；让模型/用户在结果中直接看到项目归属不一致，避免在错误项目建仓/推送后才发现 |
| ② 创建仓库 | `POST /v1/repositories`（service=codeartsrepo）body `{ project_uuid, name }` | 实测 200：返回 `{ result: { repository_uuid } }` |
| ③ 回读信息 | `GET /v1/repositories/{repository_uuid}`（service=codeartsrepo） | 实测 200：RepoInfo（repoId/name/sshUrl/httpUrl/webUrl/groupName/projectId）；建仓后 git 端异步初始化约 1s，404 时轮询等待（最长 10s） |
| ④ 返回指引 | 输出 RepoInfo + `remote_url` + `push_guidance` | **不做 git push**——由模型用宿主 bash/pwsh 执行（见"推送链路契约"） |

**输出示例**（规范化输出）：

```json
{
  "repository_uuid": "b7eb2721ee0649c0af76360101783fc5",
  "repo_id": "3089998",
  "repo_name": "test-delete",
  "url": "https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/test-delete.git",
  "web_url": "https://devcloud.cn-north-4.huaweicloud.com/codehub/3089998/home",
  "ssh_url": "git@codehub.devcloud.cn-north-4.huaweicloud.com:aef718e1ac5f4bed9d74092b3ea582ca/test-delete.git",
  "branch": "master",
  "remote_url": "https://codehub.devcloud.cn-north-4.huaweicloud.com/aef718e1ac5f4bed9d74092b3ea582ca/test-delete.git",
  "push_guidance": "git remote add origin <remote_url> && git push -u origin master"
}
```

> **create_job.scms 映射**（FE-08 §1.5 实测落定）：
> - `scm_type: "codehub"`
> - `repo_id`: 输出 `repo_id`（RepoInfo.repoId 数字主键）
> - `repo_name`: 输出 `repo_name`
> - `url`: 输出 `url`（RepoInfo.httpUrl）
> - `web_url`: 输出 `web_url`（RepoInfo.webUrl）

**推送链路契约**（push 由模型执行，2026-09-28）：

- 远端地址取输出 `remote_url`（HTTPS）或 `ssh_url`（SSH），由模型选择。
- 推荐命令：`git remote add origin <url> && git push -u origin <branch>`（无远端时）；已有远端直接 `git push origin <branch>`。
- **失败诊断由模型完成**（读 stderr 自行分类）：
  - 认证失败（`Authentication failed` / `Permission denied` / `access denied`）→ 提示用户配置 HTTPS 访问令牌（CodeArts 控制台 → 个人设置 → 代码托管 → 访问令牌）或 SSH 密钥。
  - 网络失败（`Connection timed out` / `Could not resolve host`）→ 提示用户检查网络/代理配置后重试。
  - 超时/其他 → 重试或升级用户。
- 重试上限 3 轮（对齐强制规约 #6），无果升级用户。
- **push 失败不阻断**：仓库已建 + RepoInfo 已返回，`create_job` 前置已完成；模型可继续用 RepoInfo 创建任务，同时附推送失败原因与处理建议。

**边界与错误**：

| 场景 | 行为 |
|------|------|
| 仓库已有 codehub 远端且**目标项目命中** | 返回 `{ existing_remote: true }` + 回读的 repo_id（per-project ListRepositoryByProject + GetRepository） |
| 仓库已有 codehub 远端但**目标项目未命中** | **在当前项目建仓**（2026-09-29 决策：允许新建，不跨项目找），返回新仓库 RepoInfo + `created_in_target_project:true` |
| **远端 URL 项目 ≠ 入参 projectUuid**（FE-09 R3 机制层） | **不阻断**：返回结果附加 `project_mismatch:true` + `remote_project_uuid` + `mismatch_hint`（警告文案随场景区分——created/existing）；让模型/用户在结果中直接看到项目归属不一致，避免在错误项目建仓/推送后才发现 |
| 已有远端目标项目查询异常（API 失败） | 不阻断：repo_id:null + 提示禁止用 URL 当 repo_id / 转人工 |
| projectUuid 非法 | E_PARAM（32 位小写数字字母校验） |
| CreateRepository 缺 repository_uuid | E_API |
| GetRepository 缺 repoId/sshUrl（10s 内未初始化） | E_API |
| git 只读命令（remote -v）失败（非 git 仓库） | 忽略，按无远端处理走建仓 |
