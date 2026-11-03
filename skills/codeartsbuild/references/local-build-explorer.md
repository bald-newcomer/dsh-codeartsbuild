# 本地构建探索子 agent（FE-14）

> 主 agent 在意图 1 流程中调用宿主 `subagent` 工具 spawn 一次性子 agent，子 agent 自主探索跑通本地编译，返回 build info JSON。主 agent 据此判断云端构建模板。

## 1. 调用方式

主 agent **直接调** `subagent` 工具（宿主 `dsh-base` bundle 已挂载 `dsh-tool-subagent`，提供 `subagent` 工具——不需要额外挂载）：

```
subagent(
  description: "本地构建探索",
  prompt: <本文件 §2 的 prompt 模板，填入 repoPath>,
  run_in_background: false   ← 必须显式传 false！宿主默认 continuable 模式，不传则后台异步，主 agent 拿不到 build info JSON
)
```

> **⚠️ 必须传 `run_in_background: false`**：宿主 `dsh-base` 的 `subagent` 工具默认 `backgroundMode: continuable`——不传 `run_in_background` 时走后台异步，返回 `started subagent <childId>` 而非 build info JSON。FE-14 需要 foreground 调用（等待子 agent 跑完返回结果），必须显式 `run_in_background: false`。

> **⚠️ 不要调 `list_agents` 查能力**：`list_agents`（来自 `dsh-tool-subagent-control`）只列已存在的 **continuable** children，**one-shot 子 agent 不出现**——它不反映 spawn 能力。判断是否可 spawn，看 `subagent` 工具是否在工具列表中（会话 1d8dc38a 实测：模型误调 `list_agents` 返回空后放弃 spawn，实际 `subagent` 工具由 `dsh-base` bundle 已提供）。

子 agent 工具限制（`toolFilter`）在 `dsh-base` 的 cordis.patch.yml 中已配置——子 agent 继承宿主工具集（pwsh/bash/read/glob/grep 等），不触及任何 `codeartsbuild_*` 云侧工具（子 agent 在自己的 session 中，看不到父 agent 的 codeartsbuild 工具注册）。

## 2. 子 agent prompt 模板

主 agent 调 `subagent` 时，把以下模板填入 `prompt` 参数（`{repoPath}` 替换为实际仓库路径）：

```
你的任务是在本地跑通 {repoPath} 仓库的编译构建，并输出 build info JSON。

## 探索流程

1. 探测仓库类型与环境：
   - 读 {repoPath} 下的构建配置文件（pyproject.toml / package.json / pom.xml / build.gradle / go.mod / Cargo.toml / Makefile / CMakeLists.txt 等），判断仓库类型和构建工具。
   - 探测本地构建环境版本：python --version / uv --version / node --version / mvn --version / go version / cargo --version 等（只探测存在的工具，不安装）。

2. 尝试编译构建：
   - 根据探测结果选择编译命令，尝试执行。
   - 失败时看错误信息，改命令重试（如 pip 失败改 uv、npm install 失败改 npm ci、缺依赖先装依赖等）。
   - 重试上限 5 轮，无果返回 FAILED + attempted_commands。

3. 收集产物：
   - 跑通后扫描产物目录（dist/、target/、build/ 等），登记产物名称/路径/大小。
   - 探测锁文件（uv.lock / package-lock.json / poetry.lock / Cargo.lock / go.sum 等）。

## 约束

- 不修改源码与配置文件（package.json/pyproject.toml 等不改）。
- **可创建构建前置条件**（输入文件、产物目录等非源码文件）——2026-10-26 验证发现：构建可能因"缺输入文件/目录"失败，子 agent 应自主创建前置条件后重试，而非直接 FAILED。
- 只用宿主命令工具（pwsh/bash）跑命令 + read/glob/grep 看文件。
- 不调用任何 codeartsbuild_* 工具（云侧工具）。
- 重试上限 5 轮。
- 输出必须是下面 schema 的 JSON，不要输出其他内容。

## 输出 schema

你必须输出以下 JSON（成功或失败都输出）：

```json
{
  "status": "SUCCESS | PARTIAL | FAILED",
  "repo_path": "{repoPath}",
  "repo_type": "python | npm | maven | gradle | go | rust | c | cpp | other",
  "build_tool": "uv | pip | npm | yarn | pnpm | mvn | gradle | go | cargo | make | cmake | other",
  "lockfile": "uv.lock | package-lock.json | poetry.lock | pom.xml | go.sum | Cargo.lock | null",
  "build_environment": {
    "python_version": "3.10.2 或 null",
    "uv_version": "0.4.20 或 null",
    "node_version": "v20.18.0 或 null",
    "mvn_version": "Apache Maven 3.9.6 或 null",
    "go_version": "go1.21.0 或 null",
    "os": "win32 | linux | darwin"
  },
  "build_command": "实际跑通的命令（FAILED 时为最后尝试的命令）",
  "build_artifacts": [
    {"name": "产物文件名", "path": "相对路径", "size_bytes": 12345}
  ],
  "attempted_commands": [
    {"command": "尝试过的命令", "exit_code": 1, "error": "错误摘要（前 300 字符）"}
  ]
}
```

字段说明：
- status: SUCCESS=跑通；PARTIAL=跑通但有警告；FAILED=5 轮未跑通。
- build_environment: 仅填实际相关的字段，无关字段填 null。os 必填。
- build_artifacts: FAILED 时为空数组 []。
- attempted_commands: 所有尝试过的命令（含跑通的那条），SUCCESS 时至少 1 条。
```

## 3. 主 agent 拿到 build info 后的判断

主 agent 解析子 agent 返回的 build info JSON，自行判断云端构建模板：

| build info 字段 | 主 agent 用途 |
|----------------|-------------|
| `repo_type` + `build_tool` | 选 create_job 的 language 或 stepsPlan step（如 python+uv → stepsPlan [{step:"shell-command", properties:{command:"uv sync && uv build"}}]） |
| `build_environment` | 选镜像版本（如 python_version 3.10 → image python3.10） |
| `build_command` | cloud step 的 command 覆盖值 |
| `build_artifacts` | 确认产物类型（whl/jar/镜像），决定是否加 upload-release 步骤 |
| `lockfile` | 确认依赖管理方式（uv.lock → cloud step 用 uv sync 装依赖） |

**关键**：子 agent 不输出 cloud_build_guidance——云端模板选择是主 agent 的职责。

## 4. 宿主配置（已由 dsh-base bundle 提供）

`subagent` 工具由宿主 `dsh-base` bundle 的 `cordis.patch.yml` 自动挂载——**不需要在 bundle patch 或 profile 中重复挂载**。`dsh-base` 配置：

```yaml
# dsh-base bundle 的 cordis.patch.yml（宿主自带，不需要用户配置）
- id: subagent
  name: '@deepseek-ai/dsh-subagent'
- id: subagent-spawn-in-process
  name: '@deepseek-ai/dsh-subagent-spawn-in-process'
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent
    backgroundMode: continuable   # ← 默认 continuable（后台异步），FE-14 需 run_in_background: false 走 foreground
```

> **⚠️ 不要在 bundle 的 `cordis.patch.yml` 中重复挂载 subagent 三包**：`dsh-base` 已提供，重复挂载会报
> `service "subagents" has been registered` + `DUPLICATE_PROVIDER`（2026-10-29 实测）。

> **⚠️ 不要混淆 `dsh-tool-subagent` 与 `dsh-tool-subagent-control`**：
> - `dsh-tool-subagent`：提供 **`subagent`** 工具（spawn 一次性/可继续子 agent）——**由 dsh-base 提供**
> - `dsh-tool-subagent-control`：提供 `list_agents`/`send_message`/`interrupt_agent`（控制已有 continuable 子 agent）——**不提供 spawn 能力**
>
> 会话 1d8dc38a 的错误：模型误调 `list_agents`（返回空是正常的——还没 spawn 任何子 agent），误判为"不支持子 agent"后放弃 spawn。实际 `subagent` 工具由 `dsh-base` 已提供，应直接调 `subagent` 工具。

## 5. 子 agent 工具限制说明

`toolFilter.allow` 限定的工具名是宿主已装配的工具名：
- `pwsh` / `bash`：宿主命令工具（standard agent preset 提供）
- `read` / `glob` / `grep`：宿主文件工具

**不含**：`codeartsbuild_*`（云侧工具）、`edit` / `write`（文件修改工具）——子 agent 不能改源码、不能调云侧。
