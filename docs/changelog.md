# CodeArtsBuild 插件 — 变更记录

> **文档编号**: CAB-CHANGELOG-001  
> **版本**: v0.3.0（迭代由用户决定）  
> **日期**: 2026-09-19  
> **状态**: 待评审  
> **说明**: 汇总各设计文档的版本演进（架构 / 契约 / 构建流程 / 日志清洗 / 工具详细设计 / Step 模板库 / 使用 / 错误 / PRD / 产物 / 风险）。
> **版本迭代策略**：本文件是**唯一版本源**。版本迭代为项目级决策，**由用户显式触发**（如"升版本"）；日常编辑文档不自动升版、不自动新增本文件条目。升版时统一新增条目并同步相关文档头版本号。

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-17 | 初始变更记录（汇总 2026-09-15 ~ 09-17 设计演进） |
| v0.2.8 | 2026-09-18 | **v4 禁用 + 逐项优化**：接口禁用规则扩至 v3/v4 一律禁用（仅 v1 推荐）；get_status 落定 `ShowJobBuildRecordDetail`；工作流一去 `list_projects`；projectId 会话级传递规约澄清；log-cleaner 补 ZIP 解压；组装器路径统一；运维文档/PRD 产物交付对齐 |
| v0.2.9 | 2026-09-18 | **模板验证测试套件方案设计（待办 #15 设计完成）**：新增 `docs/design/TEST-01-模板验证测试套件设计-20260918.md` v0.1.0（17 组合 + 7 边界 = 24 用例、分层执行、断言 16 条 + 字段映射 12 条、失败 3 轮修正闭环、覆盖率指标、与 #16 联动） |
| v0.3.0 | 2026-09-19 | **冗余消除（评估建议执行）**：架构 v0.7.9（§2.1 用户故事引用 PRD）、repo-analyzer v0.2.4（命令语义注释）、errors v0.2.1（错误分类引用化 + 修正 LOGIN_FAILED 重复）、auth v0.2.1（env 表引用化）、step-templates 不维护清单收敛为 §1、SKILL 配置注释与参考版本同步 |
| v0.2.0 | 2026-09-18 | openapi.yaml 输入输出对齐（契约 v0.4.8 / 架构 v0.7.6 / tool-details v0.2.0） |
| v0.2.1 | 2026-09-18 | KooCLI 实调用确认（待办 #1 完成：契约 v0.4.9 / 架构 v0.7.7 / tool-details v0.2.1） |
| v0.2.2 | 2026-09-18 | Step 模板库（FE-04-Step模板库拆解-20260918.md v0.1.0：官方模板拆解 33 个，各语言核心 step + 默认 properties） |
| v0.2.3 | 2026-09-18 | Step 模板引擎设计 + step 索引落地（FE-04-Step模板库拆解-20260918.md v0.5.0→v0.6.0；待办 #13 完成：36 插件抽取 → step-index.json） |
| v0.2.4 | 2026-09-18 | **不维护插件过滤**（用户确认 16 个"支持不好的构建"不维护，**直接删除**出模板/create_job 并注明；FE-04-Step模板库拆解-20260918.md v0.6.0→v0.6.2：§1/§2/§4 删除不维护插件、§7.1 过滤说明、step-index.json 过滤为 20 条；FE-03-工具详细设计-20260918.md §3.3 白名单删除并修正 Bazel `20054`→删除） |
| v0.2.5 | 2026-09-18 | **step 模板 + config 模板落地（待办 #14 完成）**：FE-04-Step模板库拆解-20260918.md v0.6.2→v0.7.0；产出 `docs/example/step-templates.json`（14 个常用 step 模板，properties=default_properties+必填占位）与 `docs/example/config-template.json`（CreateNewJob 请求体骨架，占位符注入）；生成脚本 `docs/example/generate-templates.py`；§7.2/§7.3 设计→落地 |
| v0.2.6 | 2026-09-18 | **模板组装工程化（评估定案）**：组装为**工程实现**（bundle 内 template-assembler.ts，非 LLM 手工拼 steps），SKILL 仅加规约不加新 skill；契约 v0.4.9→v0.5.0（create_job 增 language/stepOverrides/appendSteps，steps 与 language 二选一）、tool-details v0.2.1→v0.2.2（§3.4 组装器设计 + 伪代码）、step-templates v0.7.0→v0.7.1（§7.4 语言→组合映射表 + 组装流程）、SKILL.md（create_job 关键入参 + 强制规约 + 意图 1 模板化创建说明） |
| v0.2.7 | 2026-09-18 | **意图输入修正（stepsPlan）**：意图输入需定义**步骤顺序 + 每步参数**，非仅 language；create_job 改 `stepsPlan`（`[{ step, properties? }]`，数组顺序即步骤顺序 + 参数覆盖）为**推荐入参**，`language` 降为速选默认组合，`steps` 原样透传（最高优先），移除 stepOverrides/appendSteps；契约 v0.5.0→v0.5.1、tool-details v0.2.2→v0.2.3（§3.4 resolveStep/assembleSteps 伪代码）、step-templates v0.7.1→v0.7.2（§7.4 stepsPlan 示例）、SKILL.md（stepsPlan 规约 + 意图 1 示例） |

---

## 1. 文档版本一览（当前）

| 文档 | 版本 | 日期 |
|------|------|------|
| 架构设计 | v0.8.0 | 2026-09-20 |
| 工具接口契约 | v0.6.0 | 2026-09-20 |
| 认证说明 | v0.3.0 | 2026-09-20 |
| 代码仓构建流程（FE-01） | v0.2.4 | 2026-09-19 |
| 日志清洗器（FE-02） | v0.2.1 | 2026-09-18 |
| 工具详细设计（FE-03） | v0.3.0 | 2026-09-18 |
| Step 模板库（FE-04） | v0.7.2 | 2026-09-18 |
| 承载方案评审决策（FE-05） | 已决策 | 2026-09-20 |
| 自建 HTTP 承载切换方案（FE-06） | v0.1.0 | 2026-09-20 |
| 模板验证测试套件（TEST-01） | v0.1.0 | 2026-09-18 |
| Layer 2 全工具实调测试（TEST-02） | v0.4.0 | 2026-09-21 |
| 用户故事集成测试（TEST-03） | v0.1.0 | 2026-09-21 |
| 使用指南 | v0.3.0 | 2026-09-20 |
| 错误码排查 | v0.3.0 | 2026-09-20 |
| 需求说明（PRD） | v0.2.0 | 2026-09-18 |
| 产物规范 | v0.2.2 | 2026-09-18 |
| 风险合规 | v0.3.0 | 2026-09-20 |

---

## 2. 架构演进（architecture.md）

| 版本 | 关键变更 |
|------|----------|
| v0.1.0 | 初始草案（纯 MCP Server 方案） |
| v0.2.0 | 业务抽象层 + Harness 插件为主 + 代码仓感知 + 日志分析 |
| v0.3.0 | KooCLI 承载全部华为云调用；产物双链接；代码仓路由；日志按需 |
| v0.4.0 | DeepSeek Harness 主导（dsh 插件） |
| v0.5.0 | v3 旧版禁用、v1/v4 新接口优先（Path 实测） |
| v0.6.0 | 专注 dsh（无 MCP）；src 分包；projectId 运行时；细节迁移独立文档 |
| v0.7.0 | 契约同步（接口映射更新、时序图精简） |
| v0.7.1 | wait_build 轮询参数（指数退避/超时 TIMEOUT） |
| v0.7.2 | G2 修复闭环（≤3 轮、双路径） |
| v0.7.3 | projectId 会话级传递 |
| v0.7.4 | local-build 上移 providers/（双 Provider） |
| v0.7.5 | 产物统一结构体（type 按介质 + record_id/language） |
| v0.7.6 | openapi.yaml 输入输出对齐 |
| v0.7.7 | KooCLI 实调用确认（待办 #1 完成） |
| v0.7.8 | v4 禁用（v3/v4 一律禁用，仅 v1）；get_status 落定 ShowJobBuildRecordDetail；目录树补 template-assembler；§4.6 路径修正 |

## 3. 契约演进（api-contract.md）

| 版本 | 关键变更 |
|------|----------|
| v0.1.0 | 初始契约（16 工具） |
| v0.2.0 | KooCLI v7.2.12 实测对齐；状态枚举修订 |
| v0.3.0 | 禁用过时/待下线/旧版接口 |
| v0.3.1 | 补充各工具 URL（Path） |
| v0.4.0 | 工具全景 + 工作流编排（本地构建域 + 云侧） |
| v0.4.1 | 本地构建域收敛为 1 工具（repo_build） |
| v0.4.2 | 统一命名规约（list_records/get_record/wait_build/get_log） |
| v0.4.3 | 接口调整（ShowJobBuildRecordDetail/ShowNewOutput/ListOfficialTemplate/DownloadBuildFullLog） |
| v0.4.4 | wait_build 轮询参数补齐 |
| v0.4.5 | repo_build→create_job 映射契约 |
| v0.4.6 | 产物统一结构体 |
| v0.4.7 | 工具详细设计落地（FE-03-工具详细设计-20260918.md） |
| v0.4.8 | openapi.yaml 输入输出对齐（arch 枚举/module_id 全限定名/run_job 响应/delete 方法/分页/workflow.status/产物字段） |
| v0.4.9 | KooCLI 实调用确认（§8 逐项：record_id 对应/ListRecords UUID/ExecuteJob 分支/Delete HTTP DELETE/状态枚举冲突/CreateNewJob steps 必填/日志 ZIP） |
| v0.5.0 | 模板化组装入参（create_job 增 `language`/`stepOverrides`/`appendSteps`；steps 与 language 二选一，显式 steps 优先；模板组装由工具内组装器实现） |
| v0.5.1 | **意图输入修正**：create_job 改 `stepsPlan`（意图级步骤计划：`[{ step, properties? }]`，数组顺序即步骤顺序 + 每步参数覆盖）为推荐入参；`language` 降为速选默认组合；`steps` 原样透传（最高优先）；移除 `stepOverrides`/`appendSteps` |
| v0.5.2 | v4 禁用（v3/v4 一律禁用，仅 v1）；get_status 落定 ShowJobBuildRecordDetail（§8 #7 关闭）；工作流一去 list_projects；§7 G3 单链接；§1.2 去 MCP；repo_build 路径修正 |

## 4. 本地构建流程演进（FE-01-本地代码仓构建流程设计-20260919.md）

| 版本 | 关键变更 |
|------|----------|
| v0.1.0 | 技术栈检测规则表、编译路由 |
| v0.2.0 | AI 自主构建流程（tools/规约/异常升级/留档） |
| v0.2.1 | 收敛为单一 repo_build（模型自决） |
| v0.2.2 | recommended_steps 同构映射 |
| v0.2.3 | module_id 全限定名对齐（openapi.yaml） |

## 5. 日志清洗演进（FE-02-日志清洗器规范-20260918.md）

| 版本 | 关键变更 |
|------|----------|
| v0.1.0 | 通用日志假设（五步流水线） |
| v0.2.0 | 基于真实样本（j_KiBa9Q4j）重设计：job_key/资源池/步骤/错误码/Finished |

## 5.1 工具详细设计演进（FE-03-工具详细设计-20260918.md）

| 版本 | 关键变更 |
|------|----------|
| v0.1.0 | 16 工具详细设计：14 简单工具表格式从简 + create_job 详尽（参数组装/模板化/module_id 白名单/校验规则） |
| v0.2.0 | openapi.yaml 对齐：module_id 改全限定名白名单、arch 枚举 x86-64/arm、parameters 双层结构、run_job parameter 单数 + 响应字段、delete HTTP 方法、list_records page/limit、get_status workflow.status 映射 |
| v0.2.1 | KooCLI 实调用确认：list_records buildProjectId 36 位 UUID、get_log 需解压 ZIP、get_status workflow.status 实测 running、§4.1 状态映射表 |
| v0.2.2 | 模板化组装设计：§3.2 入参增 language/stepOverrides/appendSteps、§3.4 工程内组装器（selectTemplates/assembleSteps/assembleConfig/validateSteps + 伪代码） |
| v0.2.3 | stepsPlan 意图输入：§3.2 入参改 stepsPlan（推荐）/language（速选）/steps（透传）三选一、§3.4 组装器 resolveStep/assembleSteps 伪代码（顺序=数组顺序 + 参数覆盖） |

## 5.2 Step 模板库演进（FE-04-Step模板库拆解-20260918.md）

| 版本 | 关键变更 |
|------|----------|
| v0.1.0 | 官方模板拆解：`ListOfficialTemplate` 实测 33 个模板，提取各语言核心 step（module_id 全限定名 + 默认 properties）+ 通用附加 step（上传软件包 `20018`/制作镜像推 SWR `20004`）；语言 → 推荐步骤组合表；FE-03-工具详细设计-20260918.md §3.3 白名单同步 |
| v0.2.0 | **action 参数定义对齐**：各 step 的 properties 字段定义/image 可选值/必填项以 action 元数据实测为准（`codeci_action_XXXXX` ↔ module_id 一一对应）；upload `20018` 补全 7 字段、buildImage `20004` 补 organization、新增 OBS step（`20057` 上传 / `20063` 下载，契约 §8 #2 OBS 闭环）、各语言 image 可选值清单（Maven 10/npm 13/go 15/python 9 等） |
| v0.3.0 | **ListModulesDetail 实时接口对齐**：`CodeArtsPipeline ListModulesDetail` 实测 36 个插件（§7）；修正 Bazel uuid `20055`→`20054`、Grails/Ant/Gnu-arm image 可选值扩展、execution 内部流水线（Maven=preMaven→构建→postMaven 等）；新增插件 Flutter `20062`/Kotlin `20072`/单元测试报告 `20071`/执行Docker命令 `20035`/Android APK签名 `20033` 等；原始响应存 docs/example/modules-detail.json |
| v0.4.0 | **去冗余重构**：合并模板全景与推荐组合为 §1（标准组合并入推荐表，变体单列）；image 可选值统一至 §4 权威清单（§2 仅留 JSON 默认值）；§5 精简为关键关系（OBS/Bazel/映射）；§7→§4 实时插件清单；引用同步（tool-details/api-contract） |
| v0.5.0 | **模板引擎设计（待办 #13/#14）**：§7 step 索引（module_id 主键/name 中文名/parameters 核心参数/tags 场景标识）、step 模板、完整 config 模板（对齐 job_config.json）、组装流程、验证（#15）/更新（#16）策略；Bazel 修正回 `20055`（顶层 module_id 权威，properties.uuid=20054 属接口不一致） |
| v0.6.0 | **step 索引落地（待办 #13 完成）**：抽取 36 插件 → `docs/example/step-index.json`（module_id 主键/uuid 派生/name/description/tags 语义+os+arch/execution/parameters 精简 schema/default_properties 回填）；抽取脚本 `docs/example/extract-step-index.py` 可重跑刷新；§7.1 结构对齐实际 JSON |
| v0.6.1 | 模板引擎设计 + step 索引落地（同 v0.6.0，中间版） |
| v0.6.2 | **不维护插件过滤（用户确认）**：16 个"支持不好的构建"（Ant/Bazel/Yarn/Grunt/gulp/快应用/SetupTool/Gnu-arm/Msbuild/Sbt/Grails/mono/HarmonyOS/APK签名/Kotlin/Flutter）**不维护，直接删除**出模板/create_job 并注明（改用自定义构建环境 20017 shell + 自定义 image 或自定义执行机 linux 模式）；step-index.json **过滤为 20 条**（extract-step-index.py `UNSUPPORTED` 集合过滤）；§1 推荐组合删除不维护行（Yarn→npm、SetupTool/Msbuild/Sbt→shell）、§2 删除 Yarn/SetupTool 小节、§4 删除不维护插件行、§7.1/§7.2/§6 过滤说明 |
| v0.7.0 | **step 模板 + config 模板落地（待办 #14 完成）**：`docs/example/step-templates.json`（14 个常用 step 模板：template_id/name/module_id/properties，properties=default_properties+必填参数占位）；`docs/example/config-template.json`（CreateNewJob 请求体骨架：arch/projectId/jobName/steps/scms/parameters/flavor/hostType/buildConfigType/sourceCode/agencyUrn/groupId，`{{...}}` 占位）；生成脚本 `docs/example/generate-templates.py`；§7.2/§7.3 设计→落地 |
| v0.7.1 | **组装工程化定案**：§7.4 语言→组合映射表（17 组合 → template_id/module_id）+ 组装流程（selectTemplates→assembleSteps→assembleConfig→validateSteps）；组装为 bundle 内 template-assembler.ts，非 LLM 手工拼 |
| v0.7.2 | **stepsPlan 意图输入**：§7.4 组装流程更新（stepsPlan 逐项 resolveStep 优先，language 速选兜底）+ stepsPlan 示例（Maven→单元测试报告→上传软件包） |

---

## 6. 关键里程碑

| 日期 | 里程碑 |
|------|--------|
| 2026-09-15 | 架构草案（MCP 方案）→ 重构（业务抽象 + Harness 为主） |
| 2026-09-16 | KooCLI 实测（v7.2.12，130+ 操作）；v3 禁用/v1 优先；真实日志驱动 log-cleaner 重设计 |
| 2026-09-17 | 专注 dsh（去 MCP）；本地构建域收敛；命名规约；补齐架构缺口 #4-#9；文档序列（usage/errors/prd/artifacts/risk/changelog）；工具详细设计（FE-03-工具详细设计-20260918.md） |
| 2026-09-18 | openapi.yaml 输入输出对齐（契约 v0.4.8 / 架构 v0.7.6 / tool-details v0.2.0 / SKILL 同步）；KooCLI 实调用确认（待办 #1 完成：契约 v0.4.9 / 架构 v0.7.7 / tool-details v0.2.1 / 状态枚举 §4 修订）；官方模板拆解生成 Step 模板库（FE-04-Step模板库拆解-20260918.md v0.1.0，33 模板）；action 参数定义对齐优化模板字段（step-templates v0.2.0）；ListModulesDetail 实时接口对齐（step-templates v0.3.0：36 插件、execution 流水线）；step-templates v0.4.0 去冗余重构；step-templates v0.5.0 模板引擎设计（待办 #13-#16 设计落地）；**v4 禁用 + 逐项优化**（契约 v0.5.2 / 架构 v0.7.8 / tool-details v0.3.0 / log-cleaner v0.2.1 / SKILL / 运维文档 / PRD 同步） |

---

## 7. 待办状态

| # | 事项 | 状态 |
|---|------|------|
| 3 | projectId 项目管理（会话级传递已设计，自动选择/缓存实现待编码） | ⏳ 部分完成 |
| 10 | M2+ 后期项（缓存/并发/契约测试/KooCLI 版本/配置优先级） | ⏳ M2+ |
| 12 | 流程优化：子进程承载构建状态 loop | ⏳ 待办 |
| 15 | 模板验证测试套（调接口创建各场景任务验证） | ⏳ 待办 |
| 16 | 模板更新机制（step：重拉 ListModulesDetail；config：调 ShowJobConfig） | ⏳ 待办 |
