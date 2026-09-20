# CodeArtsBuild 插件 — 认证与凭据管理说明

> **文档编号**: CAB-AUTH-001  
> **版本**: v0.3.0（迭代由用户决定）  
> **日期**: 2026-09-20  
> **状态**: 待评审  
> **前置依赖**: 架构设计（`docs/architecture/architecture.md` §3.3.1 / §8.1 / §9.1）

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-15 | 初始说明草案（KooCLI 认证） |
| v0.2.0 | 2026-09-18 | 对齐架构 v0.6.0+ 专注 dsh 形态：移除 MCP Server 表述（§6 改 dsh 插件启动检查） |
| v0.2.1 | 2026-09-19 | §5 环境变量表改为引用架构 §8.2（消除双维护） |
| v0.3.0 | 2026-09-20 | **承载反转（SDK → 自建 HTTP）**：认证模型改为 **AK/SK 签名**（`AKSKSigner`，无 IAM token 依赖）；移除 KooCLI 表述；凭据源 hcloud-config / env |

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

### 2.1 方式一：hcloud config 兼容（默认，`credentialSource=hcloud-config`）

复用已有 `hcloud configure` 配置（`~/.hcloud/config.json` 明文 AK/SK）：

```bash
hcloud configure set --cli-access-key=AK值 --cli-secret-key=SK值
```

插件从 `~/.hcloud/config.json` 读取 `profiles[current].accessKeyId` / `secretAccessKey`，region 取 `profiles[current].region`（默认 `cn-north-4`）。

> 若 hcloud config 为加密存储（无法直接读取明文），改用方式二（环境变量）。

### 2.2 方式二：环境变量（CI 友好，`credentialSource=env`）

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

### 2.3 凭据源选择

由 cordis.yml config 配置选择（插件代码对凭据源无感知）：

```yaml
plugins:
  - id: codeartsbuild
    config:
      credentialSource: hcloud-config   # 或 env；默认 hcloud-config
```

| credentialSource | 实现 | 适用场景 |
|------------------|------|----------|
| `hcloud-config`（默认） | HcloudConfigCredentialProvider | 已有 hcloud configure 的用户（平滑迁移） |
| `env` | EnvCredentialProvider | CI/容器环境（CAB_AK/CAB_SK/CAB_REGION） |

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
| 401 Unauthorized | **hcloud config 加密存储**（AK/SK 为密文，48/76 字符非明文格式）或 AK/SK 错误 | **改用环境变量** `CAB_AK`/`CAB_SK` 提供明文（2026-09-20 实测确认：hcloud `mode: AKSK` 的 accessKeyId 为密文，直接签名 401 `APIGW.0301 Unauthorized`） |
| 403 Forbidden | 子账号权限不足 | 在 IAM 中授权 CodeArtsBuild 操作权限 |
| 签名校验失败 | 时钟偏移 / 请求被篡改 | 检查系统时间（NTP 同步）；确认无中间层改写请求 |
| `region not supported` | 区域错误 | 检查 `CAB_REGION` / hcloud config region，使用 CodeArtsBuild 支持的区域 |
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
| 日志脱敏 | 签名头为摘要（非明文）；工具结果不含凭据信息（见 log-cleaner.md §7） |
| AK/SK 轮换 | 定期轮换 AK/SK，轮换后重新配置（hcloud configure 或环境变量） |

---

## 8. 与架构文档的一致性

| 架构条目 | 本说明落实 | 状态 |
|----------|-----------|------|
| 自建 HTTP 承载全部华为云调用 | §1 认证模型 + §3 签名机制 | ✅ |
| 凭据经凭据注入抽象提供 | §2 凭据配置 | ✅ |
| 插件不接触 AK/SK 明文 | §2.3 + §7 安全 | ✅ |
| 启动检查 | §6 | ✅ |
| 接口版本白名单（v1） | 签名仅认证，URL 白名单见 api-contract.md §1.4 | ✅ |
