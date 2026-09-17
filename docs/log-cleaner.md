# CodeArtsBuild 插件 — 日志清洗器规范

> **文档编号**: CAB-LOG-001  
> **版本**: v0.2.0（基于真实日志重设计）  
> **日期**: 2026-09-16  
> **状态**: 待评审  
> **前置依赖**: 架构设计 v0.6.0（`docs/architecture.md` §4.7）、接口契约 v0.3.x（`docs/api-contract.md` §2.15）  
> **真实样本**: `docs/example/j_KiBa9Q4j.txt`（425 行，Docker 镜像构建失败，错误码 `DEV.CB.0210043`）

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-15 | 初始规范草案（通用日志假设） |
| v0.2.0 | 2026-09-16 | **基于真实日志重设计**：对齐 CodeArtsBuild 实际日志格式（`[时间][级别][步骤]: 内容`）；新增日志主 key / 资源池 / 步骤识别 / Finished 判定 / 步骤状态汇总提取；新增 CodeArtsBuild 错误码分类；重写输出 Schema |

---

## 1. 目的与范围

定义 `src/infra/log-cleaner.ts` 的实现规范：将原始构建日志清洗为结构化模型，支撑 LLM 根因分析。

**核心原则**：
1. **日志仅在 error 分析场景获取**（构建失败 / 用户显式要求），正常状态查询不触发
2. 大日志**按需截断**（三区采样），标记 `truncated`
3. 插件做**结构化和错误分类**，根因分析交给 LLM（不在插件内置 AI）
4. **对齐真实日志格式**（以 `docs/example/j_KiBa9Q4j.txt` 为基准样本）

---

## 2. 真实日志格式分析（基准样本）

### 2.1 行格式

```
[时间戳] [级别] [步骤标识] : 内容
```

| 段 | 示例 | 说明 |
|----|------|------|
| 时间戳 | `[Sep 14, 2026 02:29:37.820 GMT+08:00]` | `[Mon DD, YYYY HH:mm:ss.SSS GMT+08:00]` |
| 级别 | `[INFO]` / `[WARNING]` / `[DEBUG]` / `[ERROR]` / `[INTERNAL]` | `INTERNAL` 为内部流程日志（无外部级别语义） |
| 步骤标识 | `[buildImage:buildImage]` | `[步骤名:子步骤名]`，可缺失（如框架行 `[INTERNAL] : Execute the stage...`） |
| 内容 | `: xxx` | 冒号后为日志内容 |

**无步骤标识的行**：如 `Started by user jenkins`、`Finished: FAILURE`、`+ docker pull ...`（shell 命令）——属于框架/命令输出。

### 2.2 关键信息分布（样本实证）

| 信息 | 行号 | 示例 | 提取规则 |
|------|------|------|----------|
| 日志主 key | 2 | `onStarted: j_KiBa9Q4j #1` | `j_` + `[A-Za-z0-9]+` |
| 资源池 | 15 | `[slave] resources pool message: default-x86-2u8g_suffix` | `resources pool message: (\S+)` |
| 执行机创建 | 26-27 | `create slave: KubernetesRequest(...slaveLabel=default-x86-2u8g_suffix...)` | 可交叉验证资源池 |
| 构建步骤 | 73/106/181/231 | `[Cache Check]`/`[Code checkout]`/`[wait_job_depends]`/`[buildImage]` | `[步骤名:子步骤名] : This step is start/complete` |
| 步骤级 ERROR | 242 | `[ERROR] [buildImage:buildImage] : Execute docker command failed...` | `[ERROR]` 级别行 |
| 错误码 | 243-244 | `DEV.CB.0210043, Docker build image failed` | `[A-Z]+\.[A-Z]+\.[0-9]+` 模式 |
| 步骤状态汇总 | 411-423 | `state: state_build_image_0.buildImage, status: error` | `+++++++++++++++All Tasks Status+++++++++++++++++` 块内 |
| 最终状态 | 425 | `Finished: FAILURE` | 日志末行 |

---

## 3. 输入与输出

### 3.1 输入

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| rawLog | string | ✅ | — | 原始日志文本（download 接口获取） |
| maxBytes | number | ❌ | 262144 | 截断上限（256 KB） |
| errorFocus | boolean | ❌ | true | 是否优先提取错误段 |

### 3.2 输出 Schema

```json
{
  "job_key": "j_KiBa9Q4j",
  "resource_pool": "default-x86-2u8g_suffix",
  "byte_size": 61775,
  "truncated": false,
  "raw_sample": "string",
  "steps": [
    {
      "name": "Cache Check",
      "substep": "Cache Check",
      "status": "success",
      "line_range": [73, 101]
    },
    {
      "name": "Code checkout",
      "substep": "Code checkout#preCheckout",
      "status": "success",
      "line_range": [106, 119]
    },
    {
      "name": "buildImage",
      "substep": "buildImage",
      "status": "error",
      "line_range": [231, 260]
    }
  ],
  "structured": [
    {
      "phase": "build",
      "step": "buildImage",
      "level": "error",
      "content": "Execute docker command failed. Error message: unable to prepare context...",
      "line": 242,
      "error_type": "DOCKER_BUILD_FAILED",
      "error_code": "DEV.CB.0210043"
    }
  ],
  "error_summary": {
    "phase": "build",
    "step": "buildImage",
    "error_type": "DOCKER_BUILD_FAILED",
    "error_code": "DEV.CB.0210043",
    "message": "Execute docker command failed. Error message: unable to prepare context: unable to evaluate symlinks in Dockerfile path: lstat ***//dockerfile: no such file or directory.",
    "line": 242,
    "context": "Execute docker command failed...\ndocker build -t ... -f ./dockerfile/Dockerfile ./\n"
  },
  "finished": "FAILURE",
  "task_states": [
    { "state": "cache_check.cacheCheck-0", "status": "success" },
    { "state": "state_checkout_0.preCheckout", "status": "success" },
    { "state": "state_build_image_0.buildImage", "status": "error" }
  ]
}
```

### 3.3 输出字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| job_key | ❌ | 日志主 key（`j_` 前缀）；未匹配为 `null` |
| resource_pool | ❌ | 资源池 key（`resources pool message:` 后）；未匹配为 `null` |
| byte_size / truncated | ✅ | 体积信息 |
| raw_sample | ✅ | 采样后的日志文本 |
| steps | ✅ | 识别到的构建步骤（`This step is start` 与 `This step is complete` 之间） |
| structured | ✅ | 错误/警告级结构化行 |
| error_summary | ❌ | 错误摘要（无 error 级时为 `null`） |
| finished | ❌ | `Finished: <结果>`；未匹配为 `null` |
| task_states | ❌ | `All Tasks Status` 块的 state→status 汇总 |

---

## 4. 处理流水线

```
原始日志
  → ① 元信息提取（job_key / resource_pool）
  → ② 体积判定（byte_size / truncated）
  → ③ 三区采样（HEAD / TAIL / ERROR 上下文）
  → ④ 步骤分段（This step is start/complete）
  → ⑤ 级别分类（info / warn / error）
  → ⑥ 错误提取与分类（error_summary + error_code）
  → ⑦ 状态汇总提取（Finished + All Tasks Status）
  → 输出结构化模型
```

### 4.1 步骤①：元信息提取

| 信息 | 正则 | 说明 |
|------|------|------|
| job_key | `\b(j_[A-Za-z0-9]+)\b` | 取首个匹配；格式 `j_` + 字母数字 |
| resource_pool | `resources pool message:\s*(\S+)` | 取首个匹配；`default-x86-2u8g_suffix` 等 |

> 资源池语义：`default-*` 为公共资源池（含规格如 `x86-2u8g`）；自定义执行机资源池无 `default-` 前缀。提取值供 LLM 判断执行机类型。

### 4.2 步骤②：体积判定

| 条件 | 行为 |
|------|------|
| `byte_size ≤ maxBytes` | 全量保留，`truncated=false` |
| `byte_size > maxBytes` | 三区采样（见 4.3），`truncated=true` |

### 4.3 步骤③：三区采样（大日志）

| 区域 | 策略 |
|------|------|
| HEAD | 前 10% 字节（含 job_key、资源池、slave 创建） |
| TAIL | 最后 30% 字节（含 `Finished:` 与 `All Tasks Status`） |
| ERROR | 错误上下文前后各 20 行（`[ERROR]` 关键字定位） |

合并顺序：HEAD → ERROR → TAIL。ERROR 区与 HEAD/TAIL 重叠时优先保留 ERROR 区。

> **设计依据**：样本中元信息（job_key/资源池）在日志头部，`Finished`/`All Tasks Status` 在尾部，ERROR 在中部——三区采样恰好覆盖全部关键信息。

### 4.4 步骤④：步骤分段

基于 `This step is start` / `This step is complete` 成对标记分段：

| 规则 | 说明 |
|------|------|
| 开始标记 | `[步骤标识] : This step is start` |
| 结束标记 | `[步骤标识] : This step is complete` |
| 步骤名 | 从步骤标识 `[名:子名]` 提取（取 `名` 部分） |
| line_range | 开始行 → 结束行 |

**样本实证**（§2.2）：`Cache Check`(73-101)、`Code checkout`(106-160 含 preCheckout/checkout/postCheckout)、`wait_job_depends`(181-189)、`buildImage`(231-260)。

**无步骤标识的 shell 命令行**（`+ docker pull`、`$ docker run`）：归入当前步骤区间，不单独分段。

### 4.5 步骤⑤：级别分类

| level | 匹配规则 |
|-------|----------|
| `error` | `[ERROR]` 标记行；或内容匹配 `Failed to complete this step` / `Finished: FAILURE` 所在上下文 |
| `warn` | `[WARNING]` 标记行 |
| `info` | `[INFO]` / `[DEBUG]` / 无级别行 |
| `internal` | `[INTERNAL]` 标记行（仅统计，不进 error 分析） |

> **设计依据**：样本中 `[INTERNAL]` 占多数（框架内部日志），`[ERROR]` 是关键错误行（样本仅 4 处 `[ERROR]`）。

### 4.6 步骤⑥：错误提取与分类

提取全部 `[ERROR]` 级行，按 §5 分类表归类，取**优先级最高、行号最小**的错误作为 `error_summary`。

**CodeArtsBuild 错误码提取**：
- 正则：`\b[A-Z]{2,}\.[A-Z]{2,}\.\d{4,}\b`（如 `DEV.CB.0210043`）
- 从错误行或异常栈首行提取，写入 `error_code`

### 4.7 步骤⑦：状态汇总提取

| 信息 | 规则 |
|------|------|
| finished | 匹配 `Finished:\s*(\w+)`，取末行（`SUCCESS`/`FAILURE`） |
| task_states | 匹配 `+++++++++++++++All Tasks Status+++++++++++++++++` 与 `++++++++++++++++++++++++++++++++++++++++` 之间的 `state: (\S+), status: (\w+)` 行 |

> **设计依据**：样本 `state_build_image_0.buildImage, status: error` 精确指出失败步骤——比逐行扫描 ERROR 更可靠，应优先呈现给 LLM。

---

## 5. 错误分类表（CodeArtsBuild 适配）

### 5.1 分类表

| error_type | 匹配模式（正则，优先级从高到低） | 典型场景 |
|------------|----------------------------------|----------|
| `DOCKER_BUILD_FAILED` | `docker build` \| `unable to prepare context` \| `BuildDockerException` \| `Docker build image failed` | Docker 镜像构建失败（样本 DEV.CB.0210043） |
| `DOCKER_PULL_FAILED` | `docker pull` \| `pull access denied` \| `manifest unknown` \| `Get .*: denied` | 镜像拉取失败/不存在 |
| `COMPILE_ERROR` | `cannot find symbol` \| `COMPILATION ERROR` \| `\berror:\b` \| `symbol: class` | Java 编译失败 |
| `DEPENDENCY_MISSING` | `Could not resolve` \| `dependency not found` \| `cannot resolve` \| `404.*(repo\|repository)` \| `Could not find artifact` | Maven/Gradle 依赖缺失 |
| `TEST_FAILURE` | `Tests run:.*Failures` \| `BUILD FAILURE.*(test\|surefire)` \| `There were test failures` | 单元测试失败 |
| `TIMEOUT` | `timed? out` \| `TimeoutException` \| `exceeded the timeout` \| `timeout check` | 步骤/构建超时 |
| `OOM` | `OutOfMemoryError` \| `Killed` \| `memory limit` \| `heap space` | 内存不足 |
| `PERMISSION_DENIED` | `403` \| `Forbidden` \| `Permission denied` \| `unauthorized` \| `Access denied` | 权限/认证不足 |
| `SCRIPT_ERROR` | `Command exited with` \| `script returned exit code` \| `Step failed` \| `exit code \d+` | 脚本命令失败 |
| `LOGIN_FAILED` | `Login Succeeded`（反向）\| `login failed` \| `unauthorized.*registry` | 镜像仓库登录失败 |
| `UNKNOWN` | 其他 error 级行 | 兜底分类 |

> **新增**：`DOCKER_BUILD_FAILED`/`DOCKER_PULL_FAILED`/`LOGIN_FAILED` 为 CodeArtsBuild 样本实证场景；分类优先级高于通用错误。

### 5.2 分类判定规则

1. 每行 error 日志按上表顺序匹配，**首个命中的类型**即为该行分类
2. 多行 error 时：先按类型分组，再取**行号最小的组**作为 `error_summary`
3. `error_summary.message` = 命中的首行完整内容（截断至 500 字符）
4. `error_summary.context` = 错误行前后各 2 行（共 5 行）
5. 全部 error 行归入 `UNKNOWN` 时，`error_summary` 仍生成（`error_type=UNKNOWN`）

### 5.3 多错误场景

存在多种 error 类型时：
- `error_summary` 仅取**首个**（行号最小）
- 全部 error 行仍保留在 `structured` 中，LLM 可完整分析
- 每条 error 行标注 `error_type` / `error_code`（便于 LLM 感知多故障）

---

## 6. 截断与采样细节

| 项 | 规范 |
|----|------|
| 默认 maxBytes | 262144（256 KB） |
| HEAD 采样 | 前 10% 字节 |
| TAIL 采样 | 最后 30% 字节 |
| ERROR 上下文 | 错误行前后各 20 行（含该行） |
| raw_sample 内容 | 三区合并后的文本（`truncated=true` 时）；全量（`truncated=false`） |
| 字符边界 | 采样在字节边界近似，不做精确 UTF-8 切分 |

---

## 7. 边界情况

| 场景 | 行为 |
|------|------|
| 空日志 | 返回空 `structured`、`steps`、`task_states` 与 `error_summary=null` |
| 无 error 级日志 | `error_summary=null`，仅返回分段结果 |
| 无 `j_` 主 key | `job_key=null`，其余流程正常 |
| 无资源池信息 | `resource_pool=null` |
| 无 `Finished:` 行 | `finished=null`，以 `task_states` 为准 |
| 采样后仍超 maxBytes | 二次裁剪：优先保留 ERROR 区，丢弃 HEAD |
| 日志含凭据（AK/SK/Token/密码） | 正则脱敏（见 §8） |

---

## 8. 安全脱敏

清洗输出（`raw_sample` / `structured` / `error_summary` / `task_states`）必须脱敏：

| 模式 | 替换 |
|------|------|
| `AKID[0-9A-Za-z]{16,}` | `***` |
| `SKID[0-9A-Za-z]{16,}` | `***` |
| `(?i)authorization:\s*Bearer\s+\S+` | `***` |
| `(?i)x-auth-token:\s*\S+` | `***` |
| `docker login -u \S+ -p \S+` | `docker login -u *** -p ***` |
| 私有依赖仓库密码（`passwd=...` / `password=...`） | `***` |

> **样本实证**：第 236 行 `docker login -u cn-north-5@HST3U25OK663NMKOSYSS -p ********` 已部分脱敏（`-p ********`），清洗器需对 `-u`/`-p` 后的凭据二次脱敏。

脱敏在**输出前统一执行**；原始日志仅存在于内存处理流程，不落盘。

---

## 9. 与接口契约的一致性

| 契约字段 | 本规范来源 | 状态 |
|----------|-----------|------|
| byte_size / truncated | §4.2 体积判定 | ✅ |
| raw_sample | §4.3 三区采样 | ✅ |
| structured[].phase / level / content / line | §4.4/§4.5/§4.6 | ✅ |
| error_summary | §4.6 + §5 分类 | ✅ |
| 日志仅 error 分析获取 | 外部调用约束（契约 §2.15） | ✅ |
| **job_key / resource_pool / steps / finished / task_states** | §4.1/§4.4/§4.7（v0.2 新增） | ✅ |

## 10. 样本验证（j_KiBa9Q4j.txt）

对本样本运行清洗器，预期输出：

| 字段 | 预期值 |
|------|--------|
| job_key | `j_KiBa9Q4j` |
| resource_pool | `default-x86-2u8g_suffix`（公共资源池） |
| finished | `FAILURE` |
| steps[3] | `{name:"buildImage", status:"error", line_range:[231,260]}` |
| error_summary.error_type | `DOCKER_BUILD_FAILED` |
| error_summary.error_code | `DEV.CB.0210043` |
| error_summary.message | 含 `unable to prepare context: unable to evaluate symlinks in Dockerfile path: lstat ***//dockerfile: no such file or directory` |
| task_states 末项 | `{state:"state_build_image_0.buildImage", status:"error"}` |

> LLM 分析提示：错误根因 = `-f ./dockerfile/Dockerfile` 路径不存在（构建配置中 dockerFilePath 指向 `dockerfile/Dockerfile`，但工作区无该文件）；建议检查 Dockerfile 路径配置。
