# 本地构建（repo_build）与日志清洗（get_log）指南

## 一、repo_build：本地编译构建（AI 自主流程）

`repo_build` 内部完成：仓库类型探测 → 编译指导 → 执行编译 → 产物收集 → 自动留档。**编译命令与异常修复由模型自决**。

### 1.1 关键出参

| 字段 | 说明 |
|------|------|
| `status` | `SUCCESS` / `FAILED` / `INTERACTIVE`（已升级用户） |
| `build_info` | build_command / build_tool / language / duration_seconds |
| `artifacts` | name / path / type / size_bytes |
| `recommended_steps` | **与 create_job.steps 同构**（module_id + name），可直接作为云端任务入参；module_id 为全限定名 |
| `issues` | level / type / message / resolved |
| `archive` | 留档路径（`<repo>/.codeartsbuild/build-records/`） |

### 1.2 编译指导参考（模型可采纳或自行调整）

| 语言/工具 | 参考命令 |
|-----------|----------|
| Maven | `mvn package -DskipTests` |
| Gradle | `gradle build -x test` |
| npm/yarn | `npm run build` / `yarn build` |
| Go | `go build ./...` |
| Python | `pip install -r requirements.txt && python -m build` |
| Docker | `docker build -t {image}:{tag} .` |

> ⚠️ **与云端模板默认命令的区别**：上表为**本地编译指导**（面向本机环境、可含测试选项），与 step-templates.md 的**云端 step 默认 command**（如 Maven 默认 `mvn package -Dmaven.test.skip=true -U -e -X -B`）**不同语义**——本地指导用于 `repo_build` 执行，云端默认值用于 `create_job` 组装；`recommended_steps` 的 `command` 从实际执行的 `build_command` 推导，不照抄本地指导表。

### 1.3 异常处理与升级

| 类别 | 示例 | 自解策略 |
|------|------|----------|
| 依赖缺失 | `Could not resolve` | 安装依赖后重试 |
| 工具缺失 | `mvn: command not found` | 安装工具或换替代命令 |
| 网络异常 | 下载超时 | 重试 1 次；换镜像源 |
| 编译错误 | `cannot find symbol` | 修复后重试 |
| 配置错误 | Dockerfile 路径不存在 | 修正后重试 |
| 环境问题 | 权限/资源不足 | **升级给用户** |

**升级触发**（任一满足即升级，不得继续重试）：
1. AI 自解失败（已尝试 1 轮修复后仍失败）
2. 异常涉及用户决策（选择哪个模块/分支/镜像仓库）
3. 异常超出 AI 能力边界（需要账号凭据、需要业务确认）

**重试上限**：环境修复 1 轮 / 编译错误修复 1 轮 / 网络重试 1 次；超过上限强制升级给用户。

## 二、get_log：日志拉取 + 清洗（构建失败诊断）

> 日志**仅在 error 分析场景获取**（构建失败 / 用户显式要求），正常状态查询不触发。

### 2.1 调用链

```
get_record(取 record_id) → get_log(recordId) → 清洗 → LLM 分析根因
```

- `DownloadBuildFullLog` 返回 **ZIP 压缩包**（PK 头，内含 `message.txt` 主日志）——工具层先解压再清洗，清洗输入为解压后文本。
- 大日志**按需截断**（三区采样），标记 `truncated`。

### 2.2 清洗输出（结构化模型，供 LLM 分析）

| 字段 | 说明 |
|------|------|
| `job_key` | 日志主 key（`j_` 前缀） |
| `resource_pool` | 资源池（`default-*` 公共池含规格；无前缀为自定义执行机） |
| `truncated` / `raw_sample` | 体积信息 + 采样文本（三区：HEAD 10% / TAIL 30% / ERROR 前后各 20 行） |
| `steps` | 识别到的构建步骤（`This step is start/complete` 分段）+ 状态 |
| `structured` | 错误/警告级结构化行（phase/step/level/content/error_type/error_code） |
| `error_summary` | **错误摘要**（取优先级最高、行号最小）：error_type/error_code/message/context |
| `finished` | `Finished: <结果>`（SUCCESS/FAILURE） |
| `task_states` | `All Tasks Status` 块 state→status 汇总（**精确指出失败步骤，优先呈现给 LLM**） |

### 2.3 错误分类表（CodeArtsBuild 适配）

| error_type | 匹配特征 | 典型场景 |
|------------|----------|----------|
| `DOCKER_BUILD_FAILED` | `docker build` / `unable to prepare context` / `Docker build image failed` | 镜像构建失败（样本 DEV.CB.0210043） |
| `DOCKER_PULL_FAILED` | `docker pull` / `pull access denied` / `manifest unknown` | 镜像拉取失败 |
| `COMPILE_ERROR` | `cannot find symbol` / `COMPILATION ERROR` | Java 编译失败 |
| `DEPENDENCY_MISSING` | `Could not resolve` / `Could not find artifact` / `404.*(repo|repository)` | Maven/Gradle 依赖缺失 |
| `TEST_FAILURE` | `Tests run:.*Failures` / `BUILD FAILURE.*(test|surefire)` | 单元测试失败 |
| `TIMEOUT` | `timed? out` / `TimeoutException` / `exceeded the timeout` | 步骤/构建超时 |
| `OOM` | `OutOfMemoryError` / `Killed` / `memory limit` | 内存不足 |
| `PERMISSION_DENIED` | `403` / `Forbidden` / `Permission denied` / `unauthorized` | 权限/认证不足 |
| `SCRIPT_ERROR` | `Command exited with` / `exit code \d+` | 脚本命令失败 |
| `LOGIN_FAILED` | `login failed` / `unauthorized.*registry` | 镜像仓库登录失败 |
| `UNKNOWN` | 其他 error 级行 | 兜底分类 |

### 2.4 安全脱敏

清洗输出必须脱敏：`AKID...`/`SKID...` → `***`；`authorization: Bearer ...`/`x-auth-token: ...` → `***`；`docker login -u <user> -p <pass>` → `***`。原始日志仅内存处理，不落盘。

### 2.5 诊断提示

- `error_summary` 的 `error_code`（`[A-Z]+\.[A-Z]+\.[0-9]+`，如 `DEV.CB.0210043`）与 `task_states` 的失败步骤是根因分析的最强信号。
- 样本实证：`DOCKER_BUILD_FAILED` 根因往往是 `-f ./dockerfile/Dockerfile` 路径不存在（构建配置 dockerFilePath 指向缺失文件）——分析时检查路径配置类根因。
