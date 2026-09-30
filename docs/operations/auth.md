# CodeArtsBuild 插件 — 认证与凭据管理说明

> **文档编号**: CAB-AUTH-001  
> **版本**: v0.4.0（迭代由用户决定）  
> **日期**: 2026-09-28  
> **状态**: 待评审  
> **前置依赖**: 架构设计（`docs/architecture/architecture.md` §3.3.1 / §8.1 / §9.1）

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-15 | 初始说明草案（KooCLI 认证） |
| v0.2.0 | 2026-09-18 | 对齐架构 v0.6.0+ 专注 dsh 形态：移除 MCP Server 表述；§5 环境变量表改为引用架构 §8.2（消除双维护） |
| v0.3.0 | 2026-09-20 | **承载反转（SDK → 自建 HTTP）**：认证模型改为 **AK/SK 签名**（`AKSKSigner`，无 IAM token 依赖）；移除 KooCLI 表述；凭据源 hcloud-config / env |
| v0.4.0 | 2026-09-28 | **新增工作目录 `.dsh-codearts` 凭据源（file）**：key=value 行格式合入 env（已有环境变量优先）；默认探测链扩展（env → file → hcloud-config）；`.gitignore` 默认忽略 + 安全警示 |
| v0.5.0 | 2026-09-30 | **移除 hcloud-config 凭据源**：凭据源收敛为 `env` / `file` 两种；默认探测链改为（env → file → 报 E_CONFIG）；`HcloudConfigCredentialProvider` 已删除 |

---

## 1. 认证模型概述

**评审决策（2026-09-20）**：CodeArtsBuild 全部 OpenAPI 调用经**自建 HTTP 客户端**承载，认证方式为 **AK/SK 签名**（华为云签名算法 `SDK-HMAC-SHA256`）。插件**不接触 AK/SK 明文**（仅传入签名器），**不自行实现 IAM Token 获取/刷新**（AK/SK 签名无 token 依赖）。

```
┌─────────────────────────────┐
│ 插件（本仓库）               │
│  - CredentialProvider 读 AK/SK│
│  - AKSKSigner.sign() 进程内签名│
│  - fetch 发送请求             │
└──────────────┬──────────────┘
               │ HTTPS + Authorization: SDK-HMAC-SHA256 ...
┌──────────────▼──────────────┐
│ Huawei Cloud CodeArtsBuild   │
│  API（v1 白名单）             │
└─────────────────────────────┘
```

> 签名算法与华为云官方 SDK 同源（复用 `@huaweicloud/huaweicloud-sdk-core` 的 `AKSKSigner`），无 IAM 调用、无 token 过期问题。

---

## 2. 凭据配置

### 2.1 方式一：环境变量（CI 友好，`credentialSource=env`）

```bash
export CAB_AK=<AK>
export CAB_SK=<SK>
export CAB_REGION=<region>   # 可选，默认 cn-north-4
```

| 参数 | 说明 |
|------|------|
| `CAB_AK` | IAM 访问密钥 AK |
| `CAB_SK` | IAM 秘密密钥 SK |
| `CAB_REGION` | 云服务区域，如 `cn-north-4` |

### 2.2 方式二：工作目录 `.dsh-codearts` 文件（`credentialSource=file`，2026-09-28）

在当前工作目录创建 `.dsh-codearts` 文件（key=value 行格式，`#` 开头为注释），内容合入环境变量（**已有环境变量优先，不覆盖**）：

```bash
# .dsh-codearts（工作目录，明文）
CAB_AK=<AK>
CAB_SK=<SK>
CAB_REGION=cn-north-4        # 可选，默认 cn-north-4
# HTTPS_PROXY=http://proxycn2.huawei.com:8080   # 可选：代理也可放这里
```

适用于"不想污染全局环境、按项目隔离凭据"的场景（如多项目不同 AK/SK）。文件须加入 `.gitignore`，防止明文凭据入库。

### 2.3 凭据源选择

由 cordis.yml config 配置选择（插件代码对凭据源无感知）；**未显式配置时自动探测**（2026-09-30）：有 `CAB_AK` 环境变量 → `env`；工作目录存在 `.dsh-codearts` → `file`；否则 → 报 `E_CONFIG` 并提示配置。

```yaml
plugins:
  - id: codeartsbuild
    config:
      credentialSource: env   # 或 file；缺省自动探测
```

| credentialSource | 实现 | 适用场景 |
|------------------|------|----------|
| `env` | EnvCredentialProvider | CI/容器环境（CAB_AK/CAB_SK/CAB_REGION） |
| `file` | 读取工作目录 `.dsh-codearts` 合入 env | 按项目隔离凭据、不想污染全局环境 |

---

## 3. 签名机制（AK/SK 签名）

每个请求自动附加 `Authorization` 头：

```
Authorization: SDK-HMAC-SHA256 Access=<AK>, SignedHeaders=content-type;host;x-sdk-date, Signature=<hex>
```

签名要素：HTTP method、canonical URI、canonical query string、headers（content-type/host/x-sdk-date）、payload hash（SHA-256）。由 `AKSKSigner.sign(request, { getAk, getSk })` 生成（见 `src/infra/http-client.ts`）。

---

## 4. 认证错误排查

| 现象 | 可能原因 | 解决 |
|------|----------|------|
| 401 Unauthorized | **AK/SK 错误**（凭据不匹配） | 检查 `CAB_AK`/`CAB_SK` 是否与 IAM 密钥一致；确认无多余空格/换行 |
| 403 Forbidden | 子账号权限不足 | 在 IAM 中授权 CodeArtsBuild 操作权限 |
| 签名校验失败 | 时钟偏移 / 请求被篡改 | 检查系统时间（NTP 同步）；确认无中间层改写请求 |
| `region not supported` | 区域错误 | 检查 `CAB_REGION`，使用 CodeArtsBuild 支持的区域 |
| `E_CONFIG` 未配置凭据 | 无 `CAB_AK` 且无 `.dsh-codearts` | 按 §2 配置环境变量或 `.dsh-codearts` 文件 |
| 网络不通 | 无法访问华为云 | 检查网络/代理（参考 `proxy-setup` 技能配置内网代理）；实测需 `HTTPS_PROXY` 或 `proxyUrl` + `NODE_TLS_REJECT_UNAUTHORIZED=0`（Windows schannel 证书吊销检查失败） |

---

## 5. 插件环境变量

> **权威环境变量表见架构设计 `docs/architecture/architecture.md` §8.2**，本处为速查：

| 变量 | 必填 | 说明 |
|------|------|------|
| `CAB_AK` | 视凭据源 | AK（`credentialSource=env` 时必填） |
| `CAB_SK` | 视凭据源 | SK（`credentialSource=env` 时必填） |
| `CAB_REGION` | 视凭据源 | 区域，如 `cn-north-4`（默认 `cn-north-4`） |
| `CODEARTS_BUILD_PROJECT_ID` | 推荐 | 默认项目 ID（create_job 等需 project_id 的调用） |
| `CODEARTS_CONSOLE_BASE_URL` | ❌ | 控制台基础地址，用于拼装产物页面查询链接 |

---

## 6. 插件启动检查

dsh 插件（bundle）加载时执行以下探测（或首次工具调用时），任一失败则给出明确指引：

| 检查项 | 探测方式 | 失败处理 |
|--------|----------|----------|
| 凭据源可用 | `CredentialProvider.getCredentials()` 可返回 AK/SK | 报 `E_CONFIG` + 输出 §2 配置指引 |
| Region 可解析 | `getRegion()` 非空且 endpoint 映射表存在 | 提示设置 region |

---

## 7. 安全注意事项

| 项 | 说明 |
|----|------|
| AK/SK 保管 | AK/SK 是账号级凭据，等同密码，禁止提交到代码仓库 |
| 最小权限 | 建议创建**仅含 CodeArtsBuild 操作权限的 IAM 子账号**，使用其 AK/SK |
| 不落盘 | 插件不将凭据写入项目文件；AK/SK 仅在进程内传给签名器 |
| 日志脱敏 | 签名头为摘要（非明文）；工具结果不含凭据信息（见 FE-02-日志清洗器规范-20260918.md §7） |
| AK/SK 轮换 | 定期轮换 AK/SK，轮换后重新配置（环境变量 / .dsh-codearts） |
| `.dsh-codearts` 明文 | 该文件为明文凭据，**必须加入 .gitignore**（仓库已默认忽略）；建议限制文件权限（如 chmod 600） |

---

## 8. 与架构文档的一致性

| 架构条目 | 本说明落实 | 状态 |
|----------|-----------|------|
| 自建 HTTP 承载全部华为云调用 | §1 认证模型 + §3 签名机制 | ✅ |
| 凭据经凭据注入抽象提供 | §2 凭据配置 | ✅ |
| 插件不接触 AK/SK 明文 | §2.3 + §7 安全 | ✅ |
| 启动检查 | §6 | ✅ |
| 接口版本白名单（v1） | 签名仅认证，URL 白名单见 api-contract.md §1.4 | ✅ |
