# 🏗️ CodeArtsBuild — 一切皆插件的构建生命周期管理（dsh 插件）

> **AI-native & dsh-native 的华为云 CodeArts Build 构建工具包** — 18 个原子工具 · 6 大场景
> （本地构建 / 项目感知 / 任务编排 / 执行控制 / 状态监控 / 产物与日志）· 一条完整的
> `本地验证 → 云端构建 → 失败诊断` 闭环。**契约即实现，实测即事实。**

[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/topics/dsh-plugin)
[![license](https://img.shields.io/npm/l/@dsh-codearts/codeartsbuild)](package.json)
[![typescript](https://img.shields.io/badge/typescript-strict-3178c6)](https://www.typescriptlang.org/)

## 🧩 核心理念：Everything is a Plugin（构建版）

dsh 的哲学是 **一切皆插件**；本插件把这一哲学带到华为云构建领域——
以 **dsh 插件（bundle）** 为唯一终端形态，把构建生命周期拆成 6 大可组合场景：

```
本地构建   repo_build       探测 → 编译指导 → 执行 → 产物 → 留档（模型自决编译过程）
项目感知   list_projects    list_jobs      get_job
任务编排   create_job       update_job     delete_job     list_templates
执行控制   run_job          stop_job
状态监控   get_status       list_records   get_record     wait_build
产物/日志  list_artifacts   get_log
```

- **开放的是一整套范式**：主键依赖链（`project_id → job_id → build_no → record_id`）如何流转、
  接口契约如何定义（v1 唯一推荐、v3/v4 一律禁用）、状态枚举如何映射——而非云侧实现细节
- **你来填充**：产物能力 = 你的代码仓 + 你选的模板 + 你定的构建命令，全部模型自决
- **实测对齐**：每个工具的操作名 / URL / 参数 / 状态枚举均经华为云真实接口验证，不臆造

## 🤖 AI-Native 是有意为之（设计声明）

本插件的首要使用者是 **agent（模型）**，而非人类——从第一天起就是有意的选择：

- **工具 schema 注入系统提示**：每个契约（入参 / 输出 / 主键来源）都从模型视角书写
- **强制规约（Mandatory）**：核心主键（project_id / job_id / build_no / record_id）
  数据来源映射写死在 SKILL 中，杜绝参数来源错误
- **模板化组装**：`create_job` 传意图级 `stepsPlan`（步骤顺序 + 每步参数），
  组装器补全 module_id / 默认值，模型无需手工拼全限定名
- **模型自决编译**：`repo_build` 单工具封装探测 / 指导 / 执行 / 产物 / 留档，
  编译命令与异常修复由模型判断，工具只返回结构化结果
- **自建 HTTP 承载**：`fetch` + `AKSKSigner` AK/SK 签名，请求 / 响应完全透明，
  契约即实现，不依赖 KooCLI / SDK 黑盒

## 🚀 快速安装

### 方式一：npm（已发布到 registry 后）

```sh
npm i @dsh-codearts/codeartsbuild
```

在 cordis.yml 中装配插件：

```yaml
plugins:
  - id: codeartsbuild
    name: '@dsh-codearts/codeartsbuild'
    config:
      region: cn-north-4
      # credentialSource: env | file（缺省自动探测：有 CAB_AK 用 env → 有 .dsh-codearts 用 file → 否则报错提示配置）
      # projectId 会话级动态注入，无需在此固定
```

### 方式二：dsh CLI

```sh
dsh plugin --profile <name> add @dsh-codearts/codeartsbuild
```

### 方式三：源码构建

```sh
git clone <repo-url>
cd dsh-codeartsbuild
npm install
npm run build        # tsc → lib/
npm test             # vitest run（157 单测）
```

## 🔑 配置凭据（AK/SK）

```bash
# 方式一：环境变量（CI / 容器友好，推荐）
export CAB_AK=<AK>
export CAB_SK=<SK>
export CAB_REGION=cn-north-4

# 方式二：hcloud config 兼容（已有 hcloud configure 用户）
hcloud configure set --cli-access-key=<AK> --cli-secret-key=<SK> --cli-region=cn-north-4
```

插件**不接触 AK/SK 明文**：凭据经 `CredentialProvider` 抽象注入，进程内签名、不落盘、
不入日志（详见 `docs/operations/auth.md`）。

## 🎬 三分钟跑通完整构建闭环

向 AI 描述意图，模型按 SKILL 规约自动编排工具：

```
"基于当前项目构建并交付"
→ repo_build（本地探测+编译+产物）→ create_job（模板化组装）
→ run_job → wait_build（轮询至终态）→ list_artifacts（产物清单 + 控制台链接）
```

构建失败自动进入诊断闭环：

```
wait_build(FAILED) → get_record（取 record_id）→ get_log（拉取+ZIP 解压）
→ 日志清洗（结构化建模）→ LLM 根因分析 → 修复 → 重试 | 升级用户
```

指定分支构建 / 查询历史 / 停止构建等日常操作，均一句话触发（见 SKILL 建议操作路径）。

## 🛠️ 工具清单（18 个）

| 场景 | 工具 | 说明 |
|------|------|------|
| **本地构建** | `codeartsbuild_repo_build` | 本地构建（探测/指导/执行/产物/留档内置，模型自决） |
| | `codeartsbuild_repo_prepare` | 本地仓库准备 CodeArtsRepo（建仓+回读 RepoInfo） |
| | `codeartsbuild_repo_push` | 推送本地仓库代码到 CodeArtsRepo（一次智能尝试+失败分类） |
| **项目感知** | `codeartsbuild_list_projects` | 项目列表（v1 `ShowRelatedProject`） |
| | `codeartsbuild_list_jobs` | 任务列表（全局搜索） |
| | `codeartsbuild_get_job` | 任务详情（v1 `ShowJobConfig`） |
| **任务编排** | `codeartsbuild_create_job` | 创建任务（v1 `CreateNewJob`，模板化组装） |
| | `codeartsbuild_update_job` | 更新任务（v1 `UpdateNewJob`，全量覆盖） |
| | `codeartsbuild_delete_job` | 删除任务（v1 `DeleteTheJob`，不可逆，须确认） |
| | `codeartsbuild_list_templates` | 用户自定义模板列表（v1 `ListCustomTemplate`） |
| **执行控制** | `codeartsbuild_run_job` | 触发构建（v1 `ExecuteJob`） |
| | `codeartsbuild_stop_job` | 停止构建（v1 `StopTheJob`） |
| **状态监控** | `codeartsbuild_get_status` | 状态查询（v1 `ShowJobBuildRecordDetail`） |
| | `codeartsbuild_list_records` | 历史列表（v1 `ListRecords`） |
| | `codeartsbuild_get_record` | 记录详情（含 record_id） |
| | `codeartsbuild_wait_build` | 等待终态（轮询，指数退避） |
| **产物/日志** | `codeartsbuild_list_artifacts` | 产物清单（软件包/镜像） |
| | `codeartsbuild_get_log` | 日志拉取+清洗（ZIP 解压，仅 error 时调用） |

> 全部工具仅使用 **v1 推荐接口**；v3/v4 旧版接口一律禁用（禁用清单见 `docs/api/api-contract.md` §1.4）。

## 📚 设计要点

| 项 | 说明 |
|----|------|
| **契约驱动** | `docs/api/api-contract.md` 是工具唯一事实来源；各工具详情按 `docs/api/tools/` 拆分 |
| **实测对齐** | 操作名 / URL / 参数 / 状态枚举均经 KooCLI 实调用 + 自建 HTTP 实调验证 |
| **文档分层** | 架构（概要）→ FE 特性设计 → 接口契约 → 测试设计 → 运维文档，见 `docs/README.md` |
| **测试体系** | 157 单测 + Layer 2 全工具实调（22/22）+ 用户故事集成测试（8/8） |

## 🤝 参与贡献

- 面向 agent：请先阅读 [AGENTS.md](AGENTS.md)（工程上下文 / 工作规约 / 待办事项）
- 文档体系：见 [docs/README.md](docs/README.md)
- 反馈 / 建议：欢迎提交 Issue / PR

## 📄 许可证

[MIT](package.json)（`package.json` 声明 `license: "MIT"`）
