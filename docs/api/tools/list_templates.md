# 工具契约 — codeartsbuild_list_templates

> **来源**: `docs/api/api-contract.md` §2.13（工具接口契约，唯一事实来源）

### 2.13 codeartsbuild_list_templates

列出可用构建模板（**用户自定义模板** + **官方模板（已过滤过时模板）** + **组合场景**）。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_list_templates` |
| **场景** | C. 任务编排（配置发现） |
| **描述** | 查询用户自定义模板（`ListCustomTemplate`）+ 官方模板（`ListOfficialTemplate`，过滤过时/小众模板）+ 组合场景（combination-scenarios.json，供 stepsPlan 设计参考） |
| **承载** | 自建 HTTP（AK/SK 签名），`GET /v1/template/custom` + `GET /v1/template/officialtemplates` |
| **URL** | `/v1/template/custom`（source=custom）/ `/v1/template/officialtemplates`（source=official）/ 两个（source=all） |

**输入参数**（2026-09-23 metaRepo YAML + 真实 HTTP 实调确认；2026-11-06 加 source 入参）：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| name | string | ❌ | — | 模板名称模糊查询（长度 1~115） |
| page | number | ❌ | — | 分页页码（实调确认 ≥1） |
| pageSize | number | ❌ | 20 | 每页条数（1~100，query 名 `page_size`） |
| filter | string | ❌ | — | 过滤条件（仅 custom 接口支持） |
| tags | string | ❌ | — | 构建状态过滤条件（仅 custom 接口支持） |
| source | string | ❌ | `custom` | 查询来源：`custom`（用户自定义）/ `official`（官方模板，过滤后）/ `all`（并行查两个） |

> 与 ListOfficialTemplate 参数同构（name/page/page_size）+ 额外 `filter`/`tags`（metaRepo 实测，仅 custom 接口）。

**输出结构**（2026-11-06 精简 + 2026-11-09 加 official_step_templates）：

```json
{
  "combination_scenarios": [
    { "scenario": "Java/Maven（jar）", "steps": ["maven-build", "upload-release"], "description": "标准 jar 交付" }
    // 全部 18 个组合场景
  ],
  "custom_templates": [ ... ],  // source=custom/all 时
  "official_templates": [ ... ], // source=official/all 时（已过滤过时/平台特定模板）
  "official_step_templates": [   // source=official/all 时（从官方模板 steps 抽取去重）
    { "template_id": "maven-build", "name": "Maven构建", "module_id": "devcloud2018.codeci_action_20043.action", "properties": { "image": "maven3.5.3-jdk8-open", "command": "...", "preCondition": "SUCCESS", ... } }
    // 全部 12 个（结构对齐 step-templates.json）
  ],
  "summary": {
    "combination_count": 18,
    "custom_count": 20,
    "official_count": 13,
    "official_step_count": 12
  }
}
```

**输出说明**：

- **combination_scenarios**：语言→组合表（来自 combination-scenarios.json），供 stepsPlan 设计参考
- **custom_templates**：用户自定义模板（source=custom/all），含完整 steps[]，可直接复用
- **official_templates**：官方模板（source=official/all），**已过滤过时/小众/平台特定模板**（见下）
- **official_step_templates**：从官方模板 steps 抽取去重的 step 模板（按 module_id 去重），**结构对齐 step-templates.json**（template_id/name/module_id/properties）——供 create_job stepsPlan 选用最新 step 定义

**模板过滤**（2026-11-06 + 2026-11-09 人工评估决策，FE-18 §7）：
官方模板中以下模板在工具层直接过滤不输出（共 20 个，33→13）：
- **过时构建工具**：Ant、Grails、Grunt、gulp、mono-linux、Bazel、sbt、HarmonyOS、GNU-ARM、QuickApp
- **重复 module_id**：MSBuild for Qt、MSBuild（含 20022 upload-win 与 20018 重复）、servicestage-npm-war（含 20002 Ant）
- **平台特定模板**（需特定平台部署，非通用构建）：ServiceStage-Maven-镜像构建、serverless-npm、DevStar-Maven-容器构建、DevStar-Npm-容器构建、DevStar-Python-容器构建
- **被本地 step 模板覆盖**：Yarn（yarn-build 已纳入 step-templates.json）、Setuptools（setuptools-build 已纳入）

**SKILL 编排**：create_job 前调 `list_templates(source='official')` 查最新官方模板；组合场景见 references/language-combinations.md。
