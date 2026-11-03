# FE-13-推送链路缺陷修复-updateJob项目兜底-repoPush非git预检-20261016

> **文档编号**: CAB-FE-013
> **类型**: 独立迭代特性设计（会话缺陷修复：update_job projectId 兜底 + repo_push 非 git 预检 + 空 scms 提示增强 + git 凭据/编辑器知识沉淀）
> **日期**: 2026-10-16
> **状态**: ✅ 已实施（2026-10-16 落地，P0~P2 全部修复；AGENTS.md 待办 #19 已标注"修复已落地"）
> **上游依赖**: FE-07（scm 来源强制）、FE-08（repo_prepare/repo_push 形态 B）、FE-11（update_job body 校验）、FE-12（推送链路串联 + git 操作规约）
> **触发事件**: `docs/example/dsh-session-session-58dccf5f-...zip` 会话（2026-10-15）——"按本地仓库创建 codeartsbuild 构建任务"全流程实测，暴露 P0~P2 共 5 个缺陷点

---

## 0. 文档定位

58dccf5f 会话（2026-10-15）实测暴露 5 个缺陷点，本文档逐一设计修复方案，**仅设计**（实施由用户确认后落地）。会话详情见 `docs/example/` 下的 zip 文件（本会话未入库为 session.jsonl）。

---

## 1. 问题清单（58dccf5f 会话证据）

| # | 级别 | 问题 | 会话证据 | 影响 |
|---|------|------|---------|------|
| P0 | 高 | **`update_job` 缺 projectId 直接 E_PARAM，会话缓存未生效** | turn 9：`get_job` 回读配置 → 组装 body 未带 projectId → `update_job` 返回 `[E_PARAM] projectId 缺省且会话上下文/配置默认值均无值`；会话在第 9 轮戛然而止，**未达目标** | 补 scm 的最后一步失败，全流程中断 |
| P1 | 高 | **`create_job` 空 scms 先建任务，违反"先推代码再建任务"链路** | turn 2：模型先 `create_job`（无 scms，工具输出 `scms_empty_hint` 警告）→ 之后才 turn 3-9 手动 push 代码补源 | 命中 FE-09 D4 缺陷模式（空 scms 任务无代码源）；SKILL 意图 1 编排顺序被跳过 |
| P1 | 高 | **`repo_push` 对"本地非 git 仓库"无预检，撞 UNKNOWN** | turn 3：`repo_push` 返回 `UNKNOWN "fatal: not a git repository"`——本地 `.git` 不存在，工具把"非 git 仓库"静默吞成空 origin，push 必然失败；模型被迫手动 `git init`（还吃一次沙箱拒绝） | 工具智能尝试形态打折，模型手动补 git init 多轮 |
| P1 | 中 | **git push 凭据知识缺口：token 用户名固定 `private-token` 未沉淀** | turn 4-5：token 直嵌 URL / `oauth2:` / credential store / URL 编码四种形式全部失败，最终由用户提示"用户名固定为 private-token"才走通 | 昂贵试错（用户两次介入），SKILL/git-push.md 均未记录此知识 |
| P2 | 中 | **宿主 git 命令三连坏：`--no-edit` 不支持 / 裸 `rebase --continue` 拉起 vim 挂起 / 残留 `store` 参数污染** | turn 8-9：`rebase --continue --no-edit`（Git for Windows 不支持）→ 裸 `rebase --continue` 卡进 vim（PowerShell 非交互窗口挂起）→ `-c credential.helper='!'` 与残留 `store` 互相污染，`Unrecognized command or argument 'store'` 反复出现；最终 push 成功时 exit code 1（msys 噪音）模型差点误判 | git-push.md §1.2 已写"失败先验证再 panic"但未覆盖编辑器陷阱；模型宿主 git 熟练度不足 |

---

## 2. 设计方案（逐条）

### 2.1 P0：update_job projectId 兜底（机制层）

**现状**：`update-job.ts` 调 `resolveProjectId(body.projectId, session, envProjectId)`——body 未带 projectId 且会话/配置均无值时抛 `E_PARAM`。

**根因分析**：58dccf5f 会话中模型 turn 9 把 `get_job` 返回配置组装成 body 提交，但 `get_job` 输出中的 `projectId` 字段未进入 body（模型漏带）。会话上下文 `session.projectId` 在**该会话运行的插件版本**中未被 `create_job`（显式传参）写回——`resolveProjectId` 写回逻辑（session.ts:40）是 2026-09-22 提交 `de024c1` 的产物，58dccf5f 会话发生在 2026-10-15，理论应已生效；但 dsh-adapter 的 `sharedContext.session` 是模块级单例，**若插件进程在长会话期间被重载/重建上下文，会话缓存即丢失**（push 7 轮耗时期间风险高）。

**设计**（双层兜底）：

1. **`get_job` 输出回读兜底（工具层）**：`update_job` 入参 body 缺 projectId 时，**不抛错**——先 `GET /v1/job/{jobId}/config` 回读原任务配置，从其 `project_id` 字段解析 projectId 作为兜底（全量覆盖语义下 update_job 本来就要求先 get_job，此调用幂等安全）。兜底链：`body.projectId 显式 > 会话 > 配置默认 > get_job 回读 > E_PARAM`。
2. **错误信息引导（信息层）**：兜底链全空时，E_PARAM 详情补充"先调 get_job 取原配置，body 需含 projectId（get_job 返回的 projectId 字段）"。

**改动**：`src/providers/codeartsbuild/update-job.ts` 新增 `resolveProjectIdWithJobFallback()`（复用 `ctx.client.call` 回读 job config）；`src/core/session.ts` 不变（写回逻辑已存在）。

**测试**：cloud-handlers.test 新增——body 无 projectId + 会话无值 + get_job 回读命中 → 使用回读值；body 无 projectId + 会话有值 → 用会话值；body 无 projectId + 回读也无 → E_PARAM 且错误信息含"先 get_job"。

### 2.2 P1：repo_push 非 git 仓库预检（机制层）

**现状**：`repo-push.ts` 对"非 git 仓库"处理是——`git remote -v` 失败静默吞掉（catch → originUrl=''），随后走 `remote add origin`，`git add origin` 在非 git 仓库同样失败，push 撞 `UNKNOWN`。

**设计**：push 流程**前置 `.git` 目录存在性预检**（`fs.existsSync(path.join(repoPath, '.git'))` 或 `git rev-parse --git-dir` 探测）：

- 预检失败（非 git 仓库）→ 返回结构化 `pushed:false + reason:'not_git_repo' + next_actions:[git init 指引]`，**不抛异常、不撞 UNKNOWN**。
- 预检成功 → 维持既有流程。

**落点**：`repo-push.ts` 在 `validateInput` 之后、`detectRemoteUrl` 之前插入预检。

**测试**：repo-push.test 新增——非 git 仓库（mock `git rev-parse --git-dir` 失败）→ `pushed:false + reason:not_git_repo`；git 仓库 → 维持原流程。需 mock `fs.existsSync` 或沿用 `spawnMock` 的 `rev-parse` 路由。

### 2.3 P1：create_job 空 scms 提示增强（信息层）

**现状**：`buildScmsEmptyHint`（create-job.ts:81-86）只提示"任务无代码源，如需基于仓库构建请补 scms"——未给出**操作路径**，模型看到创建成功即继续，忽略补源。

**设计**：空 scms 提示升级为**推荐路径引导**：

```
（注意：scms 为空——任务无代码源，run_job 可能无仓库可构建；若意图是"基于仓库构建"，正确顺序为先 repo_prepare(建仓) → repo_push(推代码) → 再 create_job 带 scms；或对已建任务用 update_job 补 scms（scm_type=codehub, repo_id 来自 repo_prepare 输出）。FE-08 §1.5）
```

**落点**：`create-job.ts` 的 `buildScmsEmptyHint`。

### 2.4 P1：private-token 凭据知识沉淀（文档层）

**会话事实**：CodeArtsRepo 使用 HTTPS 访问令牌 push 时，**用户名固定为 `private-token`**，格式 `https://private-token:<TOKEN>@codehub.../...git`。本会话中 `oauth2:` / 裸 token / credential store 三种形式均被 `CH.00905401 HTTP Basic: Access denied` 拒绝。

**落点**：
- `skills/codeartsbuild/references/git-push.md` §1 凭据条目：补充"**HTTPS 访问令牌用户名固定为 `private-token`**，URL 形如 `https://private-token:<TOKEN>@codehub...`；不要用 `oauth2:`/裸 token/`AK:SK` 拼接（均实测被拒）"。
- `skills/codeartsbuild/SKILL.md` 强制规约 #9：同步补充 private-token 用法一句话。

### 2.5 P2：宿主 git 编辑器陷阱 + 命令规约补充（文档层）

**会话事实**：
- Git for Windows **不支持 `git rebase --continue --no-edit`**（unknown option `no-edit`）。
- 裸 `git rebase --continue` 拉起 vim 编辑器，在 PowerShell 非交互窗口**挂起**。
- `git -c credential.helper='!'` 与**远端 URL 或 config 残留的 `store` 参数**互相污染，报 `Unrecognized command or argument 'store'`——模型未意识到是残留损坏，反复在同一命令串上重试。

**落点**：`skills/codeartsbuild/references/git-push.md` §1.2 宿主 git 安全操作小节追加：

1. **rebase --continue 前必须设非交互编辑器**：`$env:GIT_EDITOR='true'`（或 `git -c core.editor=true rebase --continue`）——Git for Windows 无 `--no-edit` 选项。
2. **命令串残留排查**：报 `Unrecognized command or argument 'xxx'` 时先检查远端 URL / `~/.gitconfig` / 命令串是否残留损坏参数（本会话 `store` 残留），**修正而非重试同一命令**。
3. **exit code 1 ≠ 失败**：push 成功（`git log`/`git status` 确认 master 已更新）时 msys DLL 噪音的 exit code 1 不 panic（已有 §1.2 条，此处强化绑定 push 场景）。

---

## 3. 影响面

| 文件 | 改动 | 类型 |
|------|------|------|
| `src/providers/codeartsbuild/update-job.ts` | P0：projectId 兜底链 + get_job 回读 | 代码 |
| `src/providers/codeartsbuild/repo-push.ts` | P1：非 git 仓库预检（not_git_repo 结构化返回） | 代码 |
| `src/providers/codeartsbuild/create-job.ts` | P1：空 scms 提示升级（推荐路径引导） | 代码 |
| `tests/cloud-handlers.test.ts` | P0：update_job projectId 兜底用例 +3 | 测试 |
| `tests/repo-push.test.ts` | P1：非 git 预检用例 +2 | 测试 |
| `tests/create-job.test.ts` | P1：空 scms 提示断言更新 | 测试 |
| `skills/codeartsbuild/references/git-push.md` | P1/P2：private-token 凭据 + 编辑器陷阱 + 命令残留排查 | 文档 |
| `skills/codeartsbuild/SKILL.md` | P1：规约 #9 补 private-token 用法 | 文档 |
| `docs/api/api-contract.md` | P0：update_job 契约补 projectId 兜底说明（§2.5） | 文档 |
| `docs/api/tools/update_job.md` | P0：契约详情补 projectId 兜底链 | 文档 |
| `docs/api/tools/repo_push.md` | P1：契约补 not_git_repo 预检 | 文档 |

## 4. 风险与边界

- **P0 get_job 回读兜底**：update_job 前置 get_job 回读是额外一次 HTTP 调用（幂等），仅在 body 无 projectId 且会话/配置均空时触发——正常路径零开销。回读失败（任务不存在）→ 兜底链走 E_PARAM（不把 E_API 误报成参数错误，需在实现中区分）。
- **P1 非 git 预检**：`fs.existsSync(.git)` 对"gitfile 指向外置 gitdir"（worktree/submodule）会误判——预检用 `git rev-parse --git-dir`（命令探测）而非纯文件存在性，规避误判。
- **P2 编辑器陷阱**：仅文档层约束，模型可能不遵守；机制层无法拦截宿主 pwsh 命令（超出插件能力），靠规约 + 会话实测校验。
- **P1 private-token**：凭据知识属 CodeArtsRepo 平台事实，写入 skill 文档无安全风险（不记录任何真实 token 值）。

## 5. 验证方式

1. P0：cloud-handlers.test 新增 3 用例（get_job 回读兜底 / 会话兜底 / 全空 E_PARAM 含引导）+ 全量 vitest 通过 + tsc 通过。
2. P1：repo-push.test 新增 2 用例（非 git 仓库 → not_git_repo；git 仓库 → 原流程）+ create-job.test 空 scms 提示断言更新。
3. P1/P2 文档：grep 确认 git-push.md 含 `private-token`、`GIT_EDITOR`、`rebase --continue`；SKILL.md 规约 #9 含 private-token 一句话；SKILL.md 无 `docs/` 引用（自包含规约）。
4. 契约一致性：`docs/api/api-contract.md` §2.5 / tools/update_job.md / tools/repo_push.md 与实现同步。
5. 会话实测（待用户环境）：重跑"本地仓库创建构建任务"会话——验证 update_job 不再 E_PARAM、repo_push 对非 git 仓库直接提示 git init、模型不再手动拼凭据（直接 private-token:TOKEN）。
