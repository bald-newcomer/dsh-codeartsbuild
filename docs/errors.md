# CodeArtsBuild 插件 — 错误码与故障排查

> **文档编号**: CAB-ERRORS-001  
> **版本**: v0.1.0（草案）  
> **日期**: 2026-09-17  
> **状态**: 待评审  
> **前置依赖**: 接口契约 v0.4.5（`docs/api-contract.md` §3）、日志清洗器 v0.2（`docs/log-cleaner.md`）

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-17 | 初始错误码与故障排查 |

---

## 1. 错误返回格式

所有工具失败统一返回：

```json
{
  "content": [{ "type": "text", "text": "[错误码] 人类可读描述\n详情: <KooCLI/API 返回详情>" }],
  "isError": true
}
```

---

## 2. 错误码表

| 错误码 | 含义 | 典型触发 | 建议处理 |
|--------|------|----------|----------|
| `E_CONFIG` | 配置缺失/非法 | KooCLI 未安装、region 未配置 | 安装/配置 hcloud（见 auth.md） |
| `E_AUTH` | 认证失败 | AK/SK 失效、无权限 | 检查 `hcloud configure`；KooCLI 自动处理 Token |
| `E_PARAM` | 参数校验失败 | 必填缺失、类型错误 | 按字段级错误列表修正 |
| `E_API` | CodeArtsBuild 业务错误 | 任务不存在、重名、无权限 | 透传 KooCLI 错误码与描述 |
| `E_NETWORK` | 网络异常 | 超时、连接失败 | 幂等命令重试 ≤3 次后报错 |
| `E_TIMEOUT` | 构建等待超时 | wait_build 超时 | 返回 TIMEOUT（非异常）+ 最后状态 |
| `E_LOG` | 日志处理错误 | 日志过大、下载失败 | 返回 console_url 提示控制台查看 |

---

## 3. 本地构建错误分类（repo_build）

`repo_build` 失败时返回结构化 `error`，分类如下：

| error_type | 匹配模式 | 典型场景 | AI 自解策略（限 1 轮） |
|------------|----------|----------|------------------------|
| `DEPENDENCY_MISSING` | `Could not resolve` / `module not found` | 依赖缺失/下载失败 | 安装依赖后重试 |
| `TOOL_MISSING` | `command not found` | 构建工具未安装 | 安装工具或换替代命令 |
| `NETWORK_ERROR` | 超时 / 连接失败 | 下载/拉取网络异常 | 重试 1 次 / 换镜像源 |
| `COMPILE_ERROR` | `cannot find symbol` / `error:` | 编译错误 | 读上下文修复（≤1 轮） |
| `CONFIG_ERROR` | Dockerfile 路径不存在 等 | 构建配置错误 | 修正配置重试 |
| `ENV_ERROR` | 权限不足 / 资源不足 | 环境问题 | 升级用户 |
| `TIMEOUT` | 构建超时 | 超时被杀 | 提示用户确认超时配置 |
| `UNKNOWN` | 其他 | 兜底 | 升级用户 |

> 自解失败 → 进入交互升级（通知用户异常类型 + 已尝试动作 + 选项）。

---

## 4. 日志清洗错误分类（get_log）

`get_log` 清洗输出 `error_summary.error_type`（详见 log-cleaner.md §5）：

| error_type | 匹配模式 | 典型场景 |
|------------|----------|----------|
| `DOCKER_BUILD_FAILED` | `docker build` / `unable to prepare context` | Docker 镜像构建失败 |
| `DOCKER_PULL_FAILED` | `pull access denied` / `manifest unknown` | 镜像拉取失败 |
| `COMPILE_ERROR` | `cannot find symbol` / `COMPILATION ERROR` | 编译失败 |
| `DEPENDENCY_MISSING` | `Could not resolve` / `dependency not found` | 依赖缺失 |
| `TEST_FAILURE` | `Tests run:.*Failures` / `BUILD FAILURE.*test` | 测试失败 |
| `TIMEOUT` | `timed out` / `TimeoutException` | 构建/步骤超时 |
| `OOM` | `OutOfMemoryError` / `Killed` / `heap space` | 内存不足 |
| `PERMISSION_DENIED` | `403` / `Forbidden` / `unauthorized` | 权限/认证不足 |
| `SCRIPT_ERROR` | `Command exited with` / `exit code` | 脚本命令失败 |
| `LOGIN_FAILED` | `login failed` / `unauthorized.*registry` | 镜像仓库登录失败 |
| `UNKNOWN` | 其他 error 级 | 兜底 |

**CodeArtsBuild 错误码**（从日志提取）：`DEV.CB.0210043` 等格式 `[A-Z]{2,}\.[A-Z]{2,}\.\d{4,}`，可据此精确查询。

---

## 5. 故障排查场景

### 5.1 推送/认证类

| 现象 | 原因 | 排查 |
|------|------|------|
| `hcloud: command not found` | KooCLI 未安装/未加 PATH | auth.md §2 |
| 认证失败 401 | AK/SK 错误/失效 | `hcloud configure show` 重配 |
| 无权限调用 | 子账号权限不足 | IAM 授权 CodeArtsBuild 操作权限 |

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
