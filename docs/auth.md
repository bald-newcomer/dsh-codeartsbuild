# CodeArtsBuild 插件 — 认证与凭据管理说明

> **文档编号**: CAB-AUTH-001  
> **版本**: v0.1.0（草案）  
> **日期**: 2026-09-15  
> **状态**: 待评审  
> **前置依赖**: 架构设计 v0.3.0（`docs/architecture.md` §8.1）

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-15 | 初始说明草案 |

---

## 1. 认证模型概述

**评审决策 #1**：CodeArtsBuild 及华为云全部 OpenAPI 调用（含 Token 获取）统一通过 **KooCLI（`hcloud`）** 承载。插件**不直接接触 AK/SK，不自行实现 Token 获取/刷新**。

```
┌─────────────────────────────┐
│ 插件（本仓库）               │
│  - 不读取 AK/SK             │
│  - 不管理 Token             │
│  - 仅调用 hcloud 命令        │
└──────────────┬──────────────┘
               │ hcloud <operation>
┌──────────────▼──────────────┐
│ KooCLI (hcloud)             │
│  - 读取本地配置(~/.hcloud)   │
│  - 获取/缓存/刷新 Token      │
│  - 签名请求                  │
└──────────────┬──────────────┘
               │ 华为云 OpenAPI
┌──────────────▼──────────────┐
│ Huawei Cloud IAM / Services │
└─────────────────────────────┘
```

---

## 2. KooCLI 安装

### 2.1 环境要求

| 项 | 要求 |
|----|------|
| 操作系统 | Linux / macOS / Windows |
| 依赖 | 无（独立二进制） |
| 网络 | 可访问华为云 API 端点 |

### 2.2 安装方式

| 平台 | 命令 |
|------|------|
| Linux / macOS | `curl -sSL https://hwcloudcli.obs.cn-north-1.myhuaweicloud.com/cli/latest/hcloud_install.sh \| bash` |
| Windows (PowerShell) | `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser; iex (New-Object Net.WebClient).DownloadString('https://hwcloudcli.obs.cn-north-1.myhuaweicloud.com/cli/latest/hcloud_install.ps1')` |
| Windows (cmd) | 下载 `hcloud_install.bat` 执行 |
| Docker | `docker run huaweicloud/hcloud`（可选） |

> 安装后需将 `hcloud` 加入 PATH，或使用绝对路径。

### 2.3 验证安装

```bash
hcloud --version
hcloud help
```

---

## 3. 凭据配置

### 3.1 配置 AK/SK

```bash
hcloud configure set --cli-access-key=AK值 --cli-secret-key=SK值
```

| 参数 | 说明 |
|------|------|
| `--cli-access-key` | IAM 访问密钥 AK |
| `--cli-secret-key` | IAM 秘密密钥 SK |

### 3.2 配置区域与项目

```bash
# 设置默认区域（影响所有服务调用）
hcloud configure set --cli-region=cn-north-4

# 设置默认项目（可选，若需固定 project_id）
hcloud configure set --cli-project-name=<project_name> --cli-domain-name=<domain_name>
```

| 参数 | 说明 |
|------|------|
| `--cli-region` | 云服务区域，如 `cn-north-4`（华东-上海一） |
| `--cli-project-name` | IAM 项目名称 |
| `--cli-domain-name` | IAM 账号名（域名） |

### 3.3 查看配置

```bash
hcloud configure show
```

### 3.4 修改/删除配置

```bash
# 修改某项配置
hcloud configure set --cli-access-key=新AK

# 删除某项配置（置空）
hcloud configure unset --cli-access-key

# 清除全部配置
hcloud configure delete --yes
```

---

## 4. Token 管理（KooCLI 自动处理）

| 项 | 说明 |
|----|------|
| Token 获取 | 由 KooCLI 在首次调用时自动向 IAM 请求 |
| Token 缓存 | 存储在 KooCLI 本地配置目录（`~/.hcloud/`） |
| Token 刷新 | 过期前自动重新获取，插件无感知 |
| 插件介入 | **不需要**；插件仅执行 hcloud 命令 |

> 插件启动时**不主动获取 Token**，而是在首次调用工具时由 KooCLI 按需完成。

---

## 5. 插件环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `CODEARTS_BUILD_REGION` | ✅ | 区域，如 `cn-north-4`，透传给 `hcloud --cli-region` |
| `CODEARTS_BUILD_PROJECT_ID` | 推荐 | 默认项目 ID（create_job 等需 project_id 的调用） |
| `CODEARTS_CONSOLE_BASE_URL` | ❌ | 控制台基础地址，用于拼装产物页面查询链接 |

> AK/SK 不通过环境变量传给插件，统一由 KooCLI 配置管理。

---

## 6. 插件启动检查

插件（MCP Server）启动时执行以下探测，任一失败则给出明确指引：

| 检查项 | 命令 | 失败处理 |
|--------|------|----------|
| KooCLI 已安装 | `hcloud --version` | 退出 + 输出 §2.2 安装指引 |
| AK/SK 已配置 | `hcloud configure show` 含 access-key/secret-key | 退出 + 输出 §3.1 配置指引 |
| Region 已设置 | 环境变量 `CODEARTS_BUILD_REGION` 或 `hcloud configure show` | 提示设置 `--cli-region` 或环境变量 |

---

## 7. 常见问题排查

| 问题 | 可能原因 | 解决 |
|------|----------|------|
| `hcloud: command not found` | 未安装或未加入 PATH | 安装 KooCLI 并加入 PATH（§2.2） |
| `The input AK/SK is not correct` | AK/SK 错误或已失效 | 重新执行 `hcloud configure set` |
| `No permission to call this API` | 子账号权限不足 | 在 IAM 中授权 CodeArtsBuild 操作权限，或使用有权限的账号 |
| `project not found` | 项目 ID/名称错误 | 检查 `--cli-project-name` 或 `CODEARTS_BUILD_PROJECT_ID` |
| `region not supported` | 区域错误 | 检查 `--cli-region`，使用 CodeArtsBuild 支持的区域 |
| Token 失效报错 | KooCLI 缓存 Token 过期 | 重新调用即可（KooCLI 自动刷新）；仍失败则清除 `~/.hcloud/token` 后重试 |
| 网络不通 | 无法访问华为云 | 检查网络/代理（参考 `proxy-setup` 技能配置内网代理） |

---

## 8. 安全注意事项

| 项 | 说明 |
|----|------|
| AK/SK 保管 | AK/SK 是账号级凭据，等同密码，禁止提交到代码仓库 |
| 最小权限 | 建议创建**仅含 CodeArtsBuild 操作权限的 IAM 子账号**，使用其 AK/SK |
| 配置目录权限 | `~/.hcloud/` 含 AK/SK 与 Token，建议仅当前用户可读写 |
| 不落盘 | 插件不将凭据写入项目文件，工具结果不含敏感字段 |
| 日志脱敏 | 清洗后的日志不包含凭据信息（见 `docs/log-cleaner.md` §7） |
| AK/SK 轮换 | 定期轮换 AK/SK，轮换后重新执行 `hcloud configure set` |

---

## 9. 与架构文档的一致性

| 架构条目 | 本说明落实 | 状态 |
|----------|-----------|------|
| KooCLI 承载全部华为云调用 | §1 认证模型 + §4 Token 管理 | ✅ |
| 凭据由 KooCLI 管理 | §3 凭据配置 + §8 安全 | ✅ |
| 插件不接触 AK/SK | §5 环境变量 + §1 | ✅ |
| 启动检查 | §6 | ✅ |
| 待确认 #1 操作名对账 | 依赖 `hcloud codeartsbuild --help` | ⏳ |
