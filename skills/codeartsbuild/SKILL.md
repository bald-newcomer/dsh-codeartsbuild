---
name: codeartsbuild
description: >
  Huawei Cloud CodeArts Build 构建生命周期管理（dsh 插件形态）——本地编译构建、
  云端任务编排、执行控制、状态监控、产物获取、失败诊断。使用当用户提到
  CodeArts Build、CodeArtsBuild、构建任务、编译构建、build job、run build、
  build artifacts、构建产物、创建构建、执行构建、查看构建状态、构建失败分析。
triggers:
  - CodeArts Build
  - CodeArtsBuild
  - codeartsbuild
  - 构建任务
  - 编译构建
---

# CodeArtsBuild Skill（dsh 插件）

## 概述

本插件以 **dsh 插件（bundle）** 形态提供 16 个原子工具（清单见下），覆盖完整构建生命周期：

- **本地构建**（B）：`repo_build` —— 探测→编译指导→执行→产物→留档，编译过程由模型自决
- **云侧**：项目感知（A）/ 任务编排（C）/ 执行控制（D）/ 状态监控（E）/ 产物与日志（F/G）

底层华为云调用经 **自建 HTTP 承载**（AK/SK 签名，凭据经 `credentialSource` 注入：`hcloud-config` / 环境变量 `CAB_AK`/`CAB_SK`）。

---

## 工具清单

| 工具 | 定义 | 关键入参 |
|------|------|----------|
| `codeartsbuild_repo_build` | 本地构建（探测/指导/执行/产物/留档内置） | repoPath, repoType?, buildCommandHint? |
| `codeartsbuild_list_projects` | 项目列表 | — |
| `codeartsbuild_list_jobs` | 任务列表（全局） | search?, pageIndex?, pageSize? |
| `codeartsbuild_get_job` | 任务详情 | jobId |
| `codeartsbuild_create_job` | 创建任务（支持模板化组装） | projectId（用户填写）, jobName, arch, stepsPlan? 或 language? 或 steps, scms? |
| `codeartsbuild_update_job` | 更新任务 | jobId, body |
| `codeartsbuild_delete_job` | 删除任务（不可逆） | jobId |
| `codeartsbuild_list_templates` | 模板列表（官方模板） | name?, page?, pageSize? |
| `codeartsbuild_run_job` | 触发构建 | jobId, parameter?, scm? |
| `codeartsbuild_stop_job` | 停止构建 | jobId, buildNo |
| `codeartsbuild_get_status` | 状态查询（ShowJobBuildRecordDetail，result.status） | jobId, buildNo |
| `codeartsbuild_list_records` | 构建历史列表 | projectId, page?, limit? |
| `codeartsbuild_get_record` | 记录详情（含 record_id） | jobId, buildNo |
| `codeartsbuild_wait_build` | 等待终态（轮询） | jobId, buildNo |
| `codeartsbuild_list_artifacts` | 产物清单（软件包/镜像） | jobId, buildNo |
| `codeartsbuild_get_log` | 日志拉取+清洗 | recordId, logLevel?, maxBytes? |

---

## 强制规约（Mandatory —— 数据来源映射）

> 工具调用相互独立，可任意顺序调用。**强制约束：工具参数必须从正确前置渠道获取**，否则调用必然失败。

### 核心主键字段

依赖链：`project_id →(用户填写) create_job → job_id → run_job → build_no → get_record → record_id → get_log`

| 主键 | 获取方式 | 需要它的工具 |
|------|----------|--------------|
| **project_id** | **用户指定或 `list_projects` 选择**（会话级缓存，一次填写复用；显式传参覆盖） | `create_job` / `list_records` |
| **job_id** | `create_job` 返回；或 `list_jobs` 按名称（`search`）搜索 | `get_job` / `update_job` / `delete_job` / `run_job` / `stop_job` / `get_status` |
| **build_no** | `run_job` 生成（每次构建独立，同 job 内递增） | `stop_job` / `wait_build` / `get_record` / `list_artifacts` / `get_status` |
| **record_id** | `get_record(jobId, buildNo)`（唯一来源） | `get_log` |

> `create_job` 的 steps 来源（三选一，优先级 `steps` > `stepsPlan` > `language`）：
> ① `stepsPlan`（**推荐**，意图级步骤计划）：`[{ step, properties? }]`——`step` 为 step-templates.json 模板 id（如 `maven-build`/`upload-release`）或 module_id；**数组顺序即构建步骤顺序**；`properties` 覆盖该步默认参数（如 command/image/file）。模型按用户意图定义步骤顺序与每步参数。
> ② `language`（速选默认组合）：语言/场景标识（如 `Java/Maven（jar）`、`JavaScript/npm`、`Go`），展开为 step-templates.md §1 固定组合。
> ③ `steps`（原样透传，高级）：取自 `repo_build` 的 recommended_steps 或 `list_templates` 官方模板（全限定名 module_id + properties）。

### 强制约束要点

1. **projectId 会话级传递**：**首次必须由用户指定或经 `list_projects` 选择**（不硬编码、不臆造），随后自动缓存复用；后续 `create_job`/`list_records` 缺省时自动取会话上下文（架构 §4.3 优先级：显式入参 > 会话上下文 > 配置默认值 > 询问）；显式传入覆盖并刷新上下文；会话 projectId 非法（删除/无权限）时报 `E_API` 并重新选择。
2. **jobId+buildNo 必须配对**：5 个工具需同一构建的取值（同一次 `run_job` 返回或同一历史记录），不可混用。
3. **recordId 只能来自 `get_record`**。
4. **`delete_job` 不可逆**：调用前必须向用户确认。
5. **`get_log` 按需调用**：仅构建失败或用户显式要求。
6. **重试上限 3 轮**：异常修复自解限 3 轮，无果必须升级用户。

---

## 建议操作路径（Recommended —— 按用户意图编排）

以下为常见用户意图的推荐编排流程。**推荐路径可裁剪**：用户意图只覆盖部分阶段时，可跳过不相关环节。

### 意图 1：从零到完成（本地构建 → 云端任务 → 产物）

```
用户：帮我基于当前项目构建并交付（projectId 由用户提供）
repo_build → create_job → run_job → wait_build → list_artifacts
```

**模板化创建**（无本地构建时）：`create_job` 传 `stepsPlan` 定义**步骤顺序 + 每步参数**（如 `[{step:"maven-build",properties:{command:"mvn clean package"}},{step:"upload-release",properties:{file:"target/*.jar"}}]`）；简单场景可传 `language` 速选默认组合（如 `Java/Maven（jar）`）（模板清单见 step-templates.md §7.2）。

### 意图 2：仅本地构建（验证能否编译）

```
用户：这个仓库能编译吗？产物是什么
repo_build
（输出编译命令 + 产物信息 + 留档）
```

### 意图 3：仅云端已有任务（不本地构建）

```
用户：把已有任务跑一下
list_jobs / get_job → run_job → wait_build → list_artifacts
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
get_status（单次） 或 wait_build（等待终态）
```

### 意图 6：查询历史与产物

```
用户：昨天的构建结果和产物
list_records → get_record → list_artifacts
```

### 意图 7：构建失败诊断

```
用户：构建失败了，帮我看看原因
wait_build(FAILED) → get_record(取 record_id) → get_log → 日志清洗 → LLM 分析根因
    → 给出修复建议 → 修复后重试 repo_build / run_job | 无果升级用户
```

### 意图 8：配置管理

```
用户：改一下任务的构建配置 / 清理废弃任务
get_job → update_job（改配置）
list_jobs → delete_job（须确认后删）
```

---

## 配置（dsh 插件）

前置依赖：凭据已配置（`credentialSource=hcloud-config` 复用 `~/.hcloud/config.json` 明文 AK/SK，或 `credentialSource=env` 设置 `CAB_AK`/`CAB_SK`/`CAB_REGION`；详见 docs/operations/auth.md）。

```yaml
# cordis.patch.yml / profile 装配
plugins:
  - id: codeartsbuild
    name: '@dsh-codearts/codeartsbuild'
    config:
      region: cn-north-4
      # credentialSource: env | hcloud-config（默认 hcloud-config，见 docs/operations/auth.md）
      # proxyUrl: http://proxy.example.com:8080（内网代理，可选）
      # projectId 不在此固定——会话级动态注入（见"强制规约"#1：首次用户指定/list_projects 选择，后续自动复用）
```

## 参考

- 架构设计：`../../docs/architecture/architecture.md`
- 工具契约：`../../docs/api/api-contract.md`
- 本地构建流程：`../../docs/design/repo-analyzer.md`
- 日志清洗规范：`../../docs/design/log-cleaner.md`
- 工具详细设计：`../../docs/design/tool-details.md`
- Step 模板库：`../../docs/design/step-templates.md`（§1 语言→组合 / §7 模板引擎）
- 模板验证测试套件：`../../docs/design/template-validation-suite.md`（待办 #15 方案）
- [CodeArts Build API 参考](https://support.huaweicloud.com/api-codeci/cloudbuild_03_0000.html)
