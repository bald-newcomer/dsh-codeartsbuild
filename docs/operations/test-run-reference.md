# CodeArtsBuild 插件 — TEST-04 场景测试启动与验证流程（Reference）

> **文档编号**: CAB-REF-001
> **类型**: 操作参考（可复现流程；后续考虑调整为 skill 形态）
> **日期**: 2026-09-28
> **状态**: 已实测跑通（环境→装配→凭据→工具可用→真实 API 调用）
> **关联**: TEST-04-场景集成测试设计-20260922.md（CAB-TEST-004）、docs/operations/auth.md（凭据）、FE-08 §7（repo_prepare 形态）

---

## 0. 文档定位

记录 2026-09-28 在 Windows 本机**完全跑通**的 TEST-04 场景测试启动流程——从零到「dsh headless 会话能真实调用 CodeArtsBuild 云 API」。每一步含命令、预期结果、踩坑与根因。目标是**可一键复现**，并作为后续**封装为 skill** 的素材（§8）。

**与 TEST-04 的关系**：TEST-04 是"测什么"（场景/检查点/判定）；本文档是"怎么把测试跑起来"（环境/装配/凭据/验证）。执行测试前先按本文档完成启动，再按 TEST-04 跑场景。

---

## 1. 环境全景（本次实测基线）

| 项 | 值 | 说明 |
|----|-----|------|
| OS | Windows 11 Pro 10.0.26100 | 内网环境 |
| dsh CLI | v0.1.1-rc.2（`C:\Users\z30037772\AppData\Roaming\npm\dsh`） | 全局 npm 安装 |
| dsh profiles | `C:\Users\<user>\.dsh\profiles\` | headless / codeartsbuild 等 |
| 会话目录 | `C:\Users\<user>\.dsh\sessions\--D-code-ai-dsh-codeartsbuild--\` | JSONL zstd 压缩 |
| 测试仓库 | `D:\code\ai\dsh-quant`（TypeScript，npm 构建） | S1/S3 场景目标 |
| 模型 | 内网 xlb（小鲁班）provider，`XLB_API_KEY` | 见 §3.3 |
| 代理 | `HTTPS_PROXY`（proxycn2.huawei.com） | 内网访问华为云公网 API 必需 |

---

## 2. 一次性准备（首次执行）

### 2.1 凭据文件 `.dsh-codearts`（工作目录，明文）

在**插件工作目录**（dsh 会话的 workspace，如 `D:\code\ai\dsh-codeartsbuild`）创建 `.dsh-codearts`：

```bash
# .dsh-codearts（key=value 行；# 注释；文件已被仓库 .gitignore 忽略）
CAB_AK=<20位AK>
CAB_SK=<40位SK>
CAB_REGION=cn-north-4
HTTPS_PROXY=http://proxycn2.huawei.com:8080
XLB_API_KEY=<内网模型key>
```

**要点**（2026-09-28 实测）：
- AK 必须**明文格式**（20 位大写字母数字 `^[A-Z0-9]{20}$`），SK 40 位——加密存储会导致签名 401。
- `HTTPS_PROXY` 放这里即可（HttpClient 的 proxyUrl 优先级：插件 config > `HTTPS_PROXY` > `HTTP_PROXY`）。
- `XLB_API_KEY` 也放这里——dsh 的 llm 插件从 env 读它（settings.yaml 的 `apiKeyEnv: XLB_API_KEY`）。
- 文件必须与 dsh 会话 workspace 同目录（见 §4 根因）。

### 2.2 headless profile 装配插件

`C:\Users\<user>\.dsh\profiles\headless\package.json` 的 `dsh.profile.bundles` 必须含插件（**这是最容易漏的一步**）：

```json
"dsh": {
  "profile": {
    "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-headless",
      "@dsh-codearts/codeartsbuild"
    ]
  }
},
"dependencies": {
  "@dsh-codearts/codeartsbuild": "link:D:/code/ai/dsh-codeartsbuild"
}
```

> 若 bundles 缺插件，`dsh --dump-config` 看不到 codeartsbuild 条目，工具全部不可用。改完在 profile 目录跑 `pnpm install` 同步 link。

### 2.3 模型 provider

`C:\Users\<user>\.dsh\settings.yaml` 已配内网 xlb provider（`apiKeyEnv: XLB_API_KEY`）。无需改设置，key 经 `.dsh-codearts` 合入 env 即可。

---

## 3. 启动与验证（完全跑通步骤）

### 3.1 验证装配

```bash
cd D:/code/ai/dsh-codeartsbuild
dsh --profile headless --dump-config | grep codeartsbuild
# 预期：# == @dsh-codearts/codeartsbuild
#         - id: codeartsbuild
```

### 3.2 工具冒烟（18 个工具可见）

```bash
dsh --profile headless "列出你有哪些工具"
# 预期：codeartsbuild_create_job / repo_build / repo_prepare / repo_push / list_projects 等 18 个全可见
```

### 3.3 真实云 API 调用验证（凭据生效）

```bash
dsh --profile headless "请调用 codeartsbuild_list_projects 工具列出你能访问的 CodeArts 项目"
# 预期：返回真实项目列表（本次实测 202 个项目），字段 identifier/name/status 等
```

> 这步是**凭据链路终验**：file 源 → AK/SK 签名 → 华为云 API 返回数据。

---

## 4. 踩坑与根因（本次实测发现）

### 4.1 凭据源未生效：Config 默认值阻断自动探测

**现象**：`.dsh-codearts` 就位后，`list_projects` 仍报 `E_CONFIG: hcloud config AK/SK 为加密存储或不可读`（走了 hcloud-config 源）。

**根因**：`src/entry/index.ts` 的 `Config.credentialSource` 有 `.default('hcloud-config')` —— dsh 加载插件时**注入默认值**，`pluginConfig.credentialSource = 'hcloud-config'`（非 undefined），`createCredentialProvider('hcloud-config')` 强制走 hcloud-config，**绕过自动探测链**（`CAB_AK ? env : hasDotDshCodearts() ? file : hcloud-config`）。

**修复**（已合入）：`Config.credentialSource` 去掉默认值，改 `.required(false)`——未配置时 undefined → 走自动探测链。

**教训**：schemastery 的 `.default()` 会被 dsh 作为显式配置注入，**不是**"未配置时的回退"语义。要保留"缺省自动探测"，必须不设默认值。

### 4.2 hasDotDshCodearts 依赖 process.cwd

`hasDotDshCodearts()` 用 `process.cwd()` 找 `.dsh-codearts`。**dsh 主进程的 cwd 与会话 workspace 不一定一致**——从仓库目录启动（`cd D:/code/ai/dsh-codeartsbuild && dsh ...`）时两者一致，file 源才命中。**必须从插件工作目录启动 dsh**。

### 4.3 headless 输出被缓冲

`dsh --profile headless "..." > log 2>&1` 长流程时 stdout 全缓冲，进程未结束不 flush → 日志看起来"空"。**排查实际执行情况用会话记录，见 §5 常规排查链路**。

### 4.4 后台运行无 TTY 会静默退出

`dsh ... &`（后台）在无 TTY 时 headless 单次 prompt 会立即退出。**必须前台运行**，用 `timeout <秒>` 限时。

### 4.5 内网 git push 实测配置（2026-09-29 验证：代码实际推送到远端）

**内网 git 访问 codehub 的三要素**（缺一 push 不通）：

| 要素 | 配置 | 现象（未配置时） |
|------|------|------------------|
| **代理** | `git -c http.proxy=http://proxycn2.huawei.com:8080`（或 `git config http.proxy`） | `Failed to connect ... Could not connect to server`（443 超时） |
| **SSL 关闭** | `git -c http.sslVerify=false` | `SSL certificate OpenSSL verify result: self-signed certificate` |
| **凭据** | HTTPS 需 token / git credential manager 缓存 | push 被拒（认证 401） |

**已验证命令（2026-09-29 实测推通 dsh-quant → codehub）**：

```bash
git -c http.proxy=http://proxycn2.huawei.com:8080 -c http.sslVerify=false ls-remote origin   # 连通性
git -c http.proxy=http://proxycn2.huawei.com:8080 -c http.sslVerify=false push origin master  # 推送
```

**实测要点**：
- **建仓后远端常有服务端初始提交**（`Initial commit`），与本地提交**无共同祖先**——直接 push 报 `rejected (fetch first)`。需 `git fetch origin` → `git rebase origin/master`（README 可能 add/add 冲突，`git checkout --ours README.md` 取本地）→ push。
- 模型在开放会话中**不会自动知道**代理/SSL 配置——SKILL「推送链路契约」应内置这些命令（2026-09-29 会话暴露：模型 22 次 pwsh 尝试在诊断代理/凭据/锁上绕圈，未完成推送）。

---

## 5. 常规排查链路（session 排查 SOP）

> 当会话"看起来没输出"、"卡住"、"结果存疑"时，按本节链路从会话记录还原真实调用流，判定问题发生在**编排**还是**工具/凭据**层。

### 5.1 定位会话记录

```
# 每个 profile 工作目录一组；目录名为 dsh 会话 workspace 的 URL 编码
C:\Users\<user>\.dsh\sessions\--D-code-ai-dsh-codeartsbuild--\
```

按时间倒序找最新会话（`ls -lt`），每会话一个目录，内含 `session.jsonl.zstd`（zstd 压缩 JSONL，按帧追加写）。

### 5.2 解压（Node 24+ 内置 zstd）

文件是**拼接的多帧 zstd 流**（本次实测 525 帧），`zlib.ZstdDecompress` 流只解第一帧——需**扫描帧魔数 `0x28B52FFD`（BE）找边界，逐段喂给流解压拼接**：

```js
const { ZstdDecompress } = require('zlib');
const buf = fs.readFileSync('<session.jsonl.zstd>');
// ① 扫描帧边界：while 找 readUInt32BE(pos) === 0x28B52FFD，记录 start；末尾补 buf.length
// ② 逐帧：new ZstdDecompress() 流，dec.end(buf.subarray(start, end))，收集 data 拼接
// ③ 输出 utf8 → JSONL 文件
```

### 5.3 提取工具调用流

解压后是 JSONL，关键事件结构：

| 事件 | 字段路径 | 用途 |
|------|----------|------|
| `tool/call` | `data.name` + `data.arguments` | 工具名/参数（按 seq 排序即调用序列） |
| `tool/result` | `data.message.content[0].content[0].text` | 结果 JSON 文本（`isError:true` / `E_*` 判失败） |
| `assistant/message` | `data.content` | 模型中间推理（可选） |

**判定套路**：
1. 列全部 `tool/call` → 得到调用序列（对照 TEST-04 §3 检查点 L1~L12）
2. 对失败调用（`tool/result` 含 `E_` 或 `isError:true`）逐条看错误码：
   - `E_CONFIG` → 凭据/装配层问题（走 §3 启动验证）
   - `E_PARAM` → 参数/编排问题（scm 来源、module_id 白名单）
   - `E_API`/`E_AUTH` → 云 API/权限问题
   - 无错误但结果异常（如 repo_prepare 返回 `repo_id:null`）→ **语义层问题**（工具输出未被正确理解）
3. 统计重复失败次数（>3 轮即编排缺陷，强制规约 #6）

### 5.4 根因分类（映射 TEST-04 §3.3）

| 观察 | 分类 | 处置 |
|------|------|------|
| 连续同参失败 >3 轮不求助 | `escalation` | SKILL 强化重试上限 |
| 参数臆造（scm_type/module_id） | `data-sourcing` | 指向映射表/白名单 |
| 工具输出未理解（repo_id:null 仍试 create） | `reasoning` | SKILL 补输出语义说明 |
| 凭据源走错 | `E_CONFIG` | §3 启动验证 + 环境准备 |
| 构建失败/网络 | `runtime`/`dependency` | 非缺陷，记录 |

### 5.5 排查示例（2026-09-28 S1 实测）

S1 会话 5 分钟"无输出"→ 按本节解压 → 还原 42 次调用 → 定位 5 次 create_job 失败 + 5 次 repo_prepare 返回 null → 判定为**编排层缺陷**（scm 来源理解错 + 硬试超限），非凭据/工具故障。详见 §6 场景现状。

---

## 6. TEST-04 场景执行现状（2026-09-28 实测）

### 6.1 S1 本地仓库场景

**修复后执行（2026-09-28 FE-09 实施后复跑）**：`timeout 280 dsh --profile headless "按照这个仓库创建个codeartsbuild构建任务，仓库地址：D:\code\ai\dsh-quant（注意：该仓库已有 codehub 远端，repo_prepare 会返回 repo_id，用它对 create_job 组装 scms）"`

**结果：EXIT=0 自然完成，任务创建成功**（job_id=`530e7893...`）：

| 项 | 修复前（首次 S1） | 修复后（FE-09 实施后） |
|----|------------------|----------------------|
| 会话结束 | 5 分钟超时截断 | **自然完成（EXIT=0）** |
| repo_prepare | 5 次全返回 `repo_id:null` | **1 次返回 repo_id=`3090507`**（P0-A：URL 解析 projectUuid + 全局翻页命中） |
| create_job | 5 次失败硬试（422/403）→ agencyUrn 绕过 | **成功**（scm 用 repo_id + url） |
| module_id | 臆造 `com.huaweicloud...` | **`devcloud2018.codeci_action_20014.action`（npm 白名单）** |
| 代码源 | 空 scms（任务无代码源） | **codehub + repo_id=3090507 + branch=master** |

**新发现（记录）**：create_job 直接传 `repo_id` 失败（403），改传 **repo_id + url 组合**成功——scms 组装需同时含 repo_id 与 url（契约细节，待 FE-09 后续确认是否需在契约标注）。

**首次执行（FE-09 分析基线）**：`timeout 300 dsh --profile headless "按照这个仓库创建个codeartsbuild构建任务，仓库地址：D:\code\ai\dsh-quant"`

**实际轨迹**（42 次工具调用，从会话记录解压还原，2026-09-28）：

| 阶段 | 调用 | 结果 | 判定 |
|------|------|------|------|
| ① 情报收集 | list_projects(202) → read/view 仓库 → list_templates → list_jobs ×4 → get_job ×2 → pwsh git 查询 | ✅ | L2/L9 合规 |
| ② create_job 失败循环 | **5 次 create_job 失败**（#369/#466/#626/#891/#1244：422 仓库不存在 / repo_id 必填） | ❌ | **scm 来源反复错 + 重复硬试 >3 轮**（L12 违规） |
| ③ repo_prepare 空转 | **5 次 repo_prepare**（#397/#977/#1508/#1655/#1849）全部返回 `repository_uuid:null, repo_id:null` | ⚠️ | **关键缺陷**：dsh-quant 已有 codehub 远端 → repo_prepare 走"已有远端"分支不建仓，返回 null repo_id；模型未理解输出 |
| ④ 本地构建 | repo_build FAILED（缺 npm install）→ pwsh npm install | ⚠️ | runtime 非缺陷 |
| ⑤ 最终成功 | #1954 create_job（带 agencyUrn）✅ → get_job ×2 → update_job ✅ | ✅ | 任务最终创建成功（job_id=dc9b3de5...） |

**核心缺陷链（TEST-04 勾检结论）**：
1. **scm 来源链路理解错误**：repo_prepare 对"已有远端"返回 null repo_id（不建仓），模型未从"已有远端 URL 解析 repo_id"，反复用错误 scm 试 create_job（5 轮）。
2. **失败后无限硬试**：create_job 连续失败 5 次未转向求助用户（强制规约 #6 ≤3 轮）。
3. **最终绕过 scm 成功**：靠 `agencyUrn` + 空 scms 才创建成功——**未真正打通 scm 链路**。
4. module_id 曾在本地设计文件臆造（`com.huaweicloud...` 非白名单格式）——`data-sourcing`/`reasoning` 缺陷。

**结论**：环境链路（凭据/装配/工具/云 API）**已完全跑通**；S1 任务最终创建成功，但 **scm 来源编排有严重缺陷**——正是 TEST-04 要捕获的行为问题。修复方向：SKILL 需明确"repo_prepare 返回 repo_id:null 时 = 已有远端，应解析远端 URL 提取 repo_id（FE-08 §1.5）或转人工"，并强化"create_job 失败 ≤3 轮转求助"。

### 6.2 代码实际推送验证（2026-09-29，T04 S1 重点）

**目标**：验证代码真正推到远端（非只建空仓）。

**手动确定性验证（✅ 推送链路可行）**：`D:\code\ai\dsh-quant`（624d3c 项目）本地 1 提交 → 内网 push（代理 + ssl off）→ **远端 HEAD = 本地 HEAD = `0654d4b`**（481 文件）。命令见 §4.5。关键：建仓后远端有服务端初始提交（无共同祖先）→ `fetch + rebase（README 冲突取 --ours）→ push`。

**会话内验证（⚠️ 模型未在限时内完成 push）**：提示词含 push 配置要点，但模型：
1. **未按提示词先 repo_prepare 复用**——在**错误项目**（64af5f5d，list_projects 选的）建了**重复 dsh-quant 仓**（repo_id=3092221，已确认是测试垃圾）
2. **陷入"如何获取 git token"死循环**（多次尝试调 token API，内网 CodeArts 无此通道）——不知道 credential manager 已缓存可用
3. create_job：先 `step="20014"` 误用（应 `npm-build`）失败，后成功（job_id=e6ce2b0e）

**结论**：推送链路**本身已验证可行**（§4.5 确定性命令）；模型在开放会话中**不会自动应用**代理/ssl/credential 配置——SKILL 推送链路契约已补（2026-09-29），需**后续会话验证模型遵循度**。这本身是 T04 捕获的编排缺陷（`reasoning`/`escalation`）。

### 6.3 用户自跑会话分析（fd89bace，2026-09-29，49 次调用）

**结果**：任务创建成功（job_id=d8f9d132）但 **3 次 run_job 全失败**（`任务未成功下发 DEV.CB.032209` → get_status `SCHEDULE_FAILURE`），会话以 todo"完成"收尾（**虚假完成**——构建从未成功）。

**过程曲折点**（create_job 7 连败后成功）：
| # | 失败 | 分类 |
|---|------|------|
| jobName 不合法（DEV.CB.032010）→ steps.name 缺 ×2 → language=`javascript-node` 臆造 → imageName 格式错 → `Repo仓库访问失败(500)` → `指定仓库不存在(422)` → 重名 | 参数/枚举/scm 混合 |
| flavor 全程 `1cpu4g`（未校验，透传） | 契约缺口 |
| push **未执行**（#840 只换 remote 未 push）→ scm 指向空仓 → 构建无代码 | **scm 未打通根因** |

**scm 未打通根因链（严重，重点）**：
```
repo_prepare 建仓(64af5f5d) → 本地 origin 换成新仓 → ❌ 未 push 代码（git 命令无代理/ssl，必失败且未重试）
→ create_job scm 指向空仓 ✅ 创建成功（工具未校验"仓库必须有代码"）→ run_job 构建 ❌ Repo访问失败/SCHEDULE_FAILURE
```
- **R1（核心）**：push 缺失——repo_prepare 返回 `push_guidance` 但模型未执行（或执行失败未按 §4.5 配代理/ssl）
- **R2**：create_job 对"空仓 scm"不拦截（创建成功，延迟到构建期失败）
- **R3**：项目选择——用户 ask_user 选了 test(64af5f5d)，模型遵循；但候选**未含 dsh-quant 归属项目（624d3c，远端 URL 可解析）**——模型没把"远端 URL 的 projectUuid"纳入项目选择建议

**用户确认**：`未成功下发 → 不调 get_log 诊断` **符合预期**（不判缺陷）。

**已实施优化（2026-09-29）**：
| 优化 | 落地 |
|------|------|
| flavor 默认 DEFAULT + 枚举（DEFAULT/1cpu4g/2u8g） | parameters.ts + create-job.ts 校验 + create_job.md + 测试 4 用例 |
| jobName 字符集（中英文/数字/_/-，≤115） | create-job.ts 校验 + 测试 |
| language 枚举清单补全（FE-04 §1 全 9 项） | parameters.ts + create_job.md |
| 项目选择应先解析远端归属 | SKILL 补强（见 SKILL 仓库来源路由） |

### 6.4 后续场景

S2（远端仓库）/S3（模板锚点）/S4（失败诊断）未执行——环境就绪后按 TEST-04 §4 提示词跑即可。

---

## 7. 完整命令速查

```bash
# ① 装配验证
dsh --profile headless --dump-config | grep codeartsbuild

# ② 工具冒烟
dsh --profile headless "列出你有哪些工具"

# ③ 凭据终验
dsh --profile headless "请调用 codeartsbuild_list_projects 工具列出你能访问的 CodeArts 项目"

# ④ S1 场景（前台 + 限时）
cd D:/code/ai/dsh-codeartsbuild && timeout 300 dsh --profile headless \
  "按照这个仓库创建个codeartsbuild构建任务，仓库地址：D:\code\ai\dsh-quant"

# ⑤ 看会话实际调用流
# 最新会话：ls -t ~/.dsh/sessions/--D-code-ai-dsh-codeartsbuild--/
```

---

## 8. 后续 skill 化建议

本文档流程适合封装为 skill（如 `test-run-codeartsbuild`），可复现部分自动化：

| 步骤 | skill 动作 | 自动化程度 |
|------|-----------|-----------|
| §2.1 凭据文件 | 生成 `.dsh-codearts` 占位模板 + 校验 AK/SK 明文格式 | 半自动（值需用户填） |
| §2.2 profile 装配 | 检查/补全 bundles + `pnpm install` | 全自动 |
| §3.1 装配验证 | 跑 dump-config + grep | 全自动 |
| §3.2 工具冒烟 | 跑工具清单会话 | 全自动 |
| §3.3 凭据终验 | 跑 list_projects + 断言返回项目数组 | 全自动 |
| §6 场景执行 | 按 TEST-04 提示词逐场景跑 + 轨迹勾检（§5 排查链路） | 半自动（需判定） |

**封装要点**：skill 应读 TEST-04 场景定义 + 本文档启动流程；凭据值从用户输入/已存在 `.dsh-codearts` 读取，不硬编码；输出会话轨迹供 TEST-04 §4 检查点勾检。
