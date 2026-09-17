# CodeArtsBuild 插件 — 代码仓构建流程设计

> **文档编号**: CAB-REPO-001  
> **版本**: v0.2.0（AI 自主构建流程）  
> **日期**: 2026-09-16  
> **状态**: 待评审  
> **前置依赖**: 架构设计 v0.6.0（`docs/architecture.md` §4.6）、接口契约 v0.3.x（`docs/api-contract.md` §2.16）

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-15 | 初始规范草案（技术栈检测规则表、编译路由） |
| v0.2.0 | 2026-09-16 | **重构为 AI 自主构建流程设计**：编译构建对维护良好的代码仓而言可完全交给 AI 完成；本文档定义该阶段的流程、tools、规约，重点设计输入/输出/异常处理/留档，不再呈现"如何分析"的具体细节 |
| v0.2.1 | 2026-09-16 | **本地构建域收敛为单一 `repo_build`**：探测/编译指导/执行/产物/留档内置；编译命令与异常修复由模型自决 |

---

## 1. 目的与定位

### 1.1 设计前提

对于**维护良好的代码仓**，编译构建在当前 AI 能力下并非难事——识别技术栈、选定构建命令、执行构建、收集产物，均可由 AI 自主完成。

因此本阶段**不再聚焦"如何分析代码仓"**（那是具体实现细节，AI 按需自行处理），而是定义：

1. **阶段边界**：什么算"构建成功"、什么需要人工介入
2. **tools 清单**：AI 在此阶段可调用的能力
3. **规约**：输入/输出格式、结果展示规范、异常处理与升级、留档要求

### 1.2 阶段定位

```
阶段 B: 代码仓构建（本文件）
├── 输入    代码仓路径 + 可选构建目标
├── 流程    AI 自主尝试编译构建 → 规范结果展示
│           └── 异常时：AI 自解 → 无果 → 交互升级给用户
├── 输出    规范编译结果（命令/产物/状态）+ 构建留档
└── 下游    构建成功后可作为 create_job / run_job 的配置来源（契约 §2.16）
```

### 1.3 核心原则

| 原则 | 说明 |
|------|------|
| **AI 自主为主** | 构建流程由 AI 驱动，插件提供 tools 与规约，不硬编码分析逻辑 |
| **失败及时升级** | AI 尝试解决无果后，**即时通知用户交互解决**，不无限重试 |
| **结果规范化** | 编译结果按统一格式展示（编译命令、产物信息、状态） |
| **过程留档** | 构建完成后对过程留档保存，可追溯 |
| **维护良好优先** | 设计面向维护良好的代码仓；复杂/异常仓库允许升级给用户 |

---

## 2. 输入与输出

### 2.1 输入

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| repoPath | string | ✅ | CWD | 代码仓路径 |
| buildTarget | string | ❌ | — | 可选构建目标（如指定模块/镜像名），由用户或上层流程给出 |
| options | object | ❌ | — | 附加选项（如 `skipTests`、`deepScan`） |

### 2.2 输出（构建结果格式）

**规范编译结果展示**（面向用户 + 下游流程）：

```json
{
  "status": "SUCCESS | FAILED | INTERACTIVE",
  "repo_path": "D:/code/ai/demo",
  "repo_name": "demo",
  "build_info": {
    "build_command": "mvn package -DskipTests",
    "build_tool": "Maven",
    "language": "Java",
    "duration_seconds": 120,
    "start_time": "2026-09-16T10:00:00Z",
    "end_time": "2026-09-16T10:02:00Z"
  },
  "artifacts": [
    {
      "name": "demo-1.0.0.jar",
      "path": "target/demo-1.0.0.jar",
      "type": "jar",
      "size_bytes": 245760
    }
  ],
  "issues": [
    {
      "level": "warning",
      "type": "DEPENDENCY_MISSING",
      "message": "依赖 xxx 已从仓库移除，已降级为警告",
      "resolved": true
    }
  ],
  "interactive": null,
  "archive": {
    "archived": true,
    "path": ".codeartsbuild/build-records/2026-09-16_100000.json"
  }
}
```

### 2.3 状态语义

| status | 含义 | 后续动作 |
|--------|------|----------|
| `SUCCESS` | 构建成功，产物已收集 | 进入下游（create_job / run_job）或结束 |
| `FAILED` | 构建失败，异常已记录 | 留档失败记录，提示用户可查看 |
| `INTERACTIVE` | 异常无法自解，**已升级给用户** | 等待用户交互解决后继续 |

---

## 3. Tools 清单

**本地构建域收敛为单一工具**（评审确认），实际编译过程由模型自行判断：

| 工具 | 用途 | 关键入参 | 关键出参 |
|------|------|----------|----------|
| `codeartsbuild_repo_build` | **本地构建**（唯一）：内部完成 仓库类型探测 → 编译指导 → 执行编译 → 产物收集 → 自动留档 | repoPath、repoType?(自动探测)、buildCommandHint?(参考命令)、timeoutMs | 实际编译命令、产物信息、状态(SUCCESS/FAILED/TIMEOUT)、异常分类、留档路径 |

> **规约**：编译命令由模型自行判断（可传 `buildCommandHint`，缺省时工具按仓库类型给出编译指导参考）；异常修复由模型用通用 bash 能力处理（装依赖/修正命令后重调 `repo_build`）；修复无果升级给用户。

---

## 4. 流程设计（AI 自主构建）

### 4.1 主流程

```mermaid
flowchart TD
    A[模型决策: repoPath + repoType? + buildCommandHint?] --> B[调用 repo_build]
    B --> C[工具内部: 类型探测→编译指导→执行编译→产物收集→自动留档]
    C --> D{构建是否成功?}
    D -- 是 --> E[输出: SUCCESS + 编译命令 + 产物信息]
    D -- 否 --> F{模型判断异常是否可自解?}
    F -- 是 --> G[模型修复: 通用bash装依赖/修正命令]
    G --> A
    F -- 否/修复无果 --> H[交互升级: 通知用户]
    H --> I[用户解决 → 重试 | 中止]
    I -- 重试 --> A
    I -- 中止 --> J[结束, 留档已由工具自动完成]
```

### 4.2 各阶段规约（模型自决 + 工具内置）

| 阶段 | 归属 | 规约 |
|------|------|------|
| **决策** | 模型 | 确定 repoPath、repoType（可缺省自动探测）、buildCommandHint（参考命令，可缺省） |
| **探测+指导** | 工具内置 | 轻量探测语言/构建工具；按仓库类型给出编译指导（参考命令+注意点），供模型决策 |
| **构建执行** | 工具内置 | 执行模型传入/参考指导的编译命令；超时限制（默认 30 分钟）；捕获退出码与输出尾部 |
| **结果判定** | 工具内置 | 以退出码 + 输出关键字（`BUILD SUCCESS`/`Finished: SUCCESS` 等）综合判定 |
| **产物收集** | 工具内置 | 从标准产物目录/已知模式收集，登记名称/路径/类型/大小 |
| **留档** | 工具内置 | 将完整过程（输入/命令/输出摘要/产物/问题）写入 `build-records/` 归档 |
| **异常修复** | 模型 | 工具返回结构化错误分类 → 模型判断策略（通用 bash 装依赖/修正命令）→ 重调 repo_build；无果升级用户 |

### 4.3 编译指导（工具内置，供模型决策参考）

工具按仓库类型输出参考命令，模型可采纳或自行调整（**仅指导，不硬编码**）：

| 语言/工具 | 参考命令 |
|-----------|----------|
| Maven | `mvn package -DskipTests`（或带测试） |
| Gradle | `gradle build -x test`（或带测试） |
| npm/yarn | `npm run build` / `yarn build` |
| Go | `go build ./...` |
| Python | `pip install -r requirements.txt && python -m build` |
| Docker | `docker build -t {image}:{tag} .` |

> 这是**规约示例**而非检测表：AI 可结合仓库实际情况（package.json scripts、Makefile、CI 配置）自行调整命令。

---

## 5. 异常处理与交互升级

### 5.1 异常分类

| 类别 | 示例 | AI 自解策略（限 1 轮） |
|------|------|------------------------|
| **依赖缺失** | `Could not resolve` / `module not found` | 安装依赖（`npm install`/`pip install`/`mvn dependency:resolve`）后重试 |
| **工具缺失** | `mvn: command not found` | 安装构建工具或切换可用替代命令 |
| **网络异常** | 下载超时 / 连接失败 | 重试 1 次；换镜像源 |
| **编译错误** | `cannot find symbol` | 读取错误上下文，尝试修复（补依赖/改配置），限 1 轮 |
| **配置错误** | Dockerfile 路径不存在 | 检查配置，修正后重试 |
| **环境问题** | 权限不足 / 资源不足 | 升级给用户 |

### 5.2 交互升级规则（强制）

**触发条件**（任一满足即升级，不得继续重试）：
1. AI 自解失败（已尝试 1 轮修复后仍失败）
2. 异常涉及用户决策（如：选择哪个模块/分支/镜像仓库）
3. 异常超出 AI 能力边界（如：需要账号凭据、需要业务确认）

**升级方式**：
- **即时通知用户**：清晰说明异常类型、AI 已尝试的解决动作、失败原因
- **提供选项**：给用户可操作的选项（如"修正 Dockerfile 路径后重试"、"跳过此步骤"、"中止"）
- **等待交互**：用户解决后继续流程；用户中止则输出 `INTERACTIVE` 并留档

**升级通知示例**：

```
构建失败，需要你的介入：
- 异常：Dockerfile 路径 ./dockerfile/Dockerfile 不存在（DEV.CB.0210043）
- 已尝试：检查仓库内 Dockerfile 位置（未找到）
- 可选操作：
  1. 提供正确的 Dockerfile 路径
  2. 修正 dockerFilePath 配置后重试
  3. 中止本次构建
```

### 5.3 重试上限

| 项 | 上限 |
|----|------|
| 环境修复（依赖/工具安装） | 1 轮 |
| 编译错误修复 | 1 轮 |
| 网络重试 | 1 次 |
| 超过上限 | **强制升级给用户** |

---

## 6. 过程留档

### 6.1 留档要求

每次构建完成后（无论成功/失败/交互），**必须留档**：

- 归档目录：`<repo>/.codeartsbuild/build-records/`
- 文件命名：`YYYY-MM-DD_HHMMSS_<status>.json`
- 保留字段：输入参数、构建命令、输出摘要、产物清单、异常/问题列表、交互记录、耗时

### 6.2 留档内容（Schema）

```json
{
  "record_id": "2026-09-16_100000",
  "status": "SUCCESS | FAILED | INTERACTIVE",
  "repo_path": "string",
  "repo_name": "string",
  "build_target": "string | null",
  "timestamp": "2026-09-16T10:00:00Z",
  "build_command": "string",
  "build_tool": "string",
  "duration_seconds": 120,
  "artifacts": [ { "name": "string", "path": "string", "type": "string", "size_bytes": 0 } ],
  "issues": [ { "level": "error|warning", "type": "string", "message": "string", "resolved": true, "resolved_by": "ai|user" } ],
  "interactions": [ { "time": "string", "type": "upgrade|user_input", "content": "string" } ],
  "output_tail": "string"
}
```

### 6.3 留档用途

- **可追溯**：构建过程完全可回溯，供后续问题定位
- **复用**：成功记录可作为 `create_job` 配置参考（契约 §2.16）
- **沉淀**：失败记录沉淀为经验，辅助后续诊断

---

## 7. 边界情况

| 场景 | 行为 |
|------|------|
| 空目录 / 路径不存在 | 报 `E_PARAM`，提示用户检查路径 |
| 非 git 仓 | 正常构建，branch 记为 `null` |
| 无构建工具且无法安装 | 升级给用户（INTERACTIVE） |
| 构建超时 | 中止并留档，提示用户 |
| Monorepo 多模块 | AI 探测后询问用户选择目标模块（升级交互） |
| 产物未生成但构建"成功" | 警告提示，标记产物为空 |

---

## 8. 与架构/契约的一致性

| 架构/契约条目 | 本设计落实 | 状态 |
|--------------|-----------|------|
| 架构 §4.6 代码仓分析器 | 重构为 AI 自主构建流程（probe/build/artifact/archive） | ✅ |
| 契约 §2.16 repo_build | 输出对齐规范编译结果格式（§2.2） | ✅ |
| G1 自动创建并执行 | 本阶段输出可作为 create_job 配置来源 | ✅ |
| 日志留档 | 与 log-cleaner.md 的输出可关联（失败时取日志分析） | ✅ |
