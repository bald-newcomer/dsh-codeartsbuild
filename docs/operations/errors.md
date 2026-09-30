# CodeArtsBuild 插件 — 错误码与故障排查

> **文档编号**: CAB-ERRORS-001  
> **版本**: v0.3.0（迭代由用户决定）  
> **日期**: 2026-09-20  
> **状态**: 待评审  
> **前置依赖**: 接口契约（`docs/api/api-contract.md` §3）、日志清洗器（`docs/design/FE-02-日志清洗器规范-20260918.md`）

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-17 | 初始错误码与故障排查 |
| v0.2.0 | 2026-09-18 | 对齐契约 v0.5.2 与 log-cleaner v0.2.1：§4 日志分类补充 DOCKER_BUILD_FAILED/DOCKER_PULL_FAILED/LOGIN_FAILED |
| v0.2.1 | 2026-09-19 | **错误分类引用化**：§3/§4 改引用 FE-01/FE-02 分类表（消除双维护）；修正 §4 LOGIN_FAILED 重复行 |
| v0.3.0 | 2026-09-20 | **承载反转（KooCLI → 自建 HTTP）**：§1 错误返回格式 `<KooCLI/API>` → `<HTTP/API>`；§2 错误码表 KooCLI 表述改 HTTP 签名/凭据；§5.1 排查场景更新（hcloud → CAB_AK/SK、代理、密文存储） |

---

## 1. 错误返回格式

所有工具失败统一返回：

```json
{
  "content": [{ "type": "text", "text": "[错误码] 人类可读描述\n详情: <HTTP/API 返回详情>" }],
  "isError": true
}
```

---

## 2. 错误码表

| 错误码 | 含义 | 典型触发 | 建议处理 |
|--------|------|----------|----------|
| `E_CONFIG` | 配置缺失/非法 | 凭据未配置（env 缺 CAB_AK/SK 或 hcloud config 不可读）、region 无 endpoint | 配置凭据（见 auth.md §2） |
| `E_AUTH` | 认证失败 | AK/SK 失效（401）、无权限（403） | 检查 AK/SK 与权限；hcloud config 密文时改用环境变量 |
| `E_PARAM` | 参数校验失败 | 必填缺失、类型错误、module_id 非白名单 | 按字段级错误列表修正 |
| `E_API` | CodeArtsBuild 业务错误 | 任务不存在、重名、无权限 | 透传 HTTP 响应 error_code/error_msg |
| `E_NETWORK` | 网络异常 | 超时、连接失败、代理不通 | 幂等请求重试 ≤3 次后报错；检查代理 |
| `E_TIMEOUT` | 构建等待超时 | wait_build 超时 | 返回 TIMEOUT（非异常）+ 最后状态 |
| `E_LOG` | 日志处理错误 | 日志过大、下载失败 | 返回 console_url 提示控制台查看 |

---

## 3. 本地构建错误分类（repo_build）

> **权威分类表见 `docs/design/FE-01-本地代码仓构建流程设计-20260919.md` §5.1**（8 类：DEPENDENCY_MISSING/TOOL_MISSING/NETWORK_ERROR/COMPILE_ERROR/CONFIG_ERROR/ENV_ERROR/TIMEOUT/UNKNOWN + AI 自解策略），本处为速查摘要：

| error_type | 典型场景 | AI 自解策略（限 1 轮） |
|------------|----------|------------------------|
| `DEPENDENCY_MISSING` | 依赖缺失/下载失败 | 安装依赖后重试 |
| `TOOL_MISSING` | 构建工具未安装 | 安装工具或换替代命令 |
| `NETWORK_ERROR` | 下载/拉取网络异常 | 重试 1 次 / 换镜像源 |
| `COMPILE_ERROR` | 编译错误 | 读上下文修复（≤1 轮） |
| `CONFIG_ERROR` | 构建配置错误 | 修正配置重试 |
| `ENV_ERROR` | 环境问题（权限/资源） | 升级用户 |
| `TIMEOUT` | 构建超时 | 提示用户确认超时配置 |
| `UNKNOWN` | 其他 | 升级用户 |

> 完整匹配模式见 FE-01-本地代码仓构建流程设计-20260919.md §5.1。自解失败 → 进入交互升级（通知用户异常类型 + 已尝试动作 + 选项）。

---

## 4. 日志清洗错误分类（get_log）

> **权威分类表见 `docs/design/FE-02-日志清洗器规范-20260918.md` §5.1**（11 类，含 DOCKER_BUILD_FAILED/DOCKER_PULL_FAILED/LOGIN_FAILED），本处为速查摘要：

| error_type | 典型场景 |
|------------|----------|
| `DOCKER_BUILD_FAILED` | Docker 镜像构建失败（样本 DEV.CB.0210043） |
| `DOCKER_PULL_FAILED` | 镜像拉取失败/不存在 |
| `LOGIN_FAILED` | 镜像仓库登录失败 |
| `COMPILE_ERROR` | 编译失败 |
| `DEPENDENCY_MISSING` | 依赖缺失 |
| `TEST_FAILURE` | 测试失败 |
| `TIMEOUT` | 构建/步骤超时 |
| `OOM` | 内存不足 |
| `PERMISSION_DENIED` | 权限/认证不足 |
| `SCRIPT_ERROR` | 脚本命令失败 |
| `UNKNOWN` | 兜底 |

> 完整匹配模式与优先级见 FE-02-日志清洗器规范-20260918.md §5.1/§5.2。**CodeArtsBuild 错误码**（从日志提取）：`DEV.CB.0210043` 等格式 `[A-Z]{2,}\.[A-Z]{2,}\.\d{4,}`，可据此精确查询。

---

## 5. 故障排查场景

### 5.1 推送/认证类

| 现象 | 原因 | 排查 |
|------|------|------|
| 凭据未配置 `E_CONFIG` | env 缺 CAB_AK/SK 或 hcloud config 不可读 | auth.md §2 配置凭据 |
| 认证失败 401 | AK/SK 错误/失效，或 hcloud config 密文存储 | 改用环境变量 `CAB_AK`/`CAB_SK`（auth.md §4） |
| 无权限调用 403 | 子账号权限不足 | IAM 授权 CodeArtsBuild 操作权限 |
| 网络不通 `E_NETWORK` | 内网无法直连华为云 | 配置代理（`HTTPS_PROXY` 或 config proxyUrl）；Windows 需 `NODE_TLS_REJECT_UNAUTHORIZED=0` |

### 5.2 构建类

| 现象 | 原因 | 排查 |
|------|------|------|
| 任务创建失败（重名） | jobName 冲突 | 换名或 `list_jobs` 确认 |
| run_job 找不到任务 | jobId 错误 | `get_job` 确认 ID |
| wait_build 一直 RUNNING | 构建中/卡住 | 检查 `get_status`；超时返回 TIMEOUT |
| 构建 FAILED | 编译/依赖/配置问题 | G2：get_log → 分类 → 修复闭环 |
| 产物为空 | 无产物产出/目录不对 | 检查构建步骤产物路径 |

### 5.3 日志类

| 现象 | 原因 | 排查 |
|------|------|------|
| get_log 失败 | recordId 错误 | recordId 只能来自 `get_record` 的 `build_record_id` |
| 日志截断（truncated=true） | 日志超 maxBytes | 提示用户控制台查看全文 |

---

## 6. 重试与升级策略

| 项 | 上限 | 说明 |
|----|------|------|
| 网络幂等重试 | ≤3 次 | GET 类命令 |
| wait_build 网络抖动 | ≤2 次（间隔 2s） | 单次查询失败 |
| 本地构建自解 | 1 轮 | 依赖/工具/网络/编译 |
| G2 修复闭环 | 3 轮 | 每轮 = 诊断+修复+重跑 |
| 超过上限 | 升级用户 | 附完整尝试记录 |

---

## 7. 与契约一致性

| 契约条目 | 本文件落实 | 状态 |
|----------|-----------|------|
| 契约 §3 错误码表 | §2 完整对齐 | ✅ |
| 契约 §2.16 异常分类 | §3 完整对齐 | ✅ |
| log-cleaner §5 分类 | §4 完整对齐 | ✅ |
| wait_build 超时行为 | §6（TIMEOUT 非异常） | ✅ |
