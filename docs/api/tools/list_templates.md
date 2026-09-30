# 工具契约 — codeartsbuild_list_templates

> **来源**: `docs/api/api-contract.md` §2.13（工具接口契约，唯一事实来源）

### 2.13 codeartsbuild_list_templates

列出可用构建模板（**用户自定义模板**）。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_list_templates` |
| **场景** | C. 任务编排（配置发现） |
| **描述** | 查询**用户自定义模板**（`ListCustomTemplate`）；用于创建构建任务前检查是否有可直接使用的用户自建模板。**官方模板（`ListOfficialTemplate`）不在本工具查询范围**——仅作 `step-templates.json` 步骤模板库的离线初始化数据源（见 FE-04 §6 来源与刷新） |
| **承载** | 自建 HTTP（AK/SK 签名），`GET /v1/template/custom` |
| **URL** | `/v1/template/custom` |

**输入参数**（2026-09-23 metaRepo YAML + 真实 HTTP 实调确认）：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| name | string | ❌ | — | 模板名称模糊查询（长度 1~115） |
| page | number | ❌ | — | 分页页码（实调确认 ≥1） |
| pageSize | number | ❌ | 20 | 每页条数（1~100，query 名 `page_size`） |
| filter | string | ❌ | — | 过滤条件 |
| tags | string | ❌ | — | 构建状态过滤条件 |

> 与 ListOfficialTemplate 参数同构（name/page/page_size）+ 额外 `filter`/`tags`（metaRepo 实测）。

**输出示例**（2026-09-23 真实 HTTP 实调，响应与 ListOfficialTemplate 同构）：

```json
{
  "result": {
    "items": [
      {
        "favourite": true,
        "nick_name": "gray1",
        "id": "10332",
        "uuid": "81d54b0ee4da4561b05b2252a00a1b75",
        "template": {
          "steps": [
            { "properties": { "image": "maven3.5.3-jdk8-open", "command": "mvn package -Dmaven.test.skip=true ..." },
              "module_id": "devcloud2018.codeci_action_20043.action", "name": "Maven构建", "version": null, "enable": true }
          ]
        },
        "type": "codeci",
        "name": "lxw1229",
        "scope": "custom",
        "description": "",
        "parameters": []
      }
    ],
    "total_size": 20
  },
  "error": null,
  "status": "success"
}
```

> 工具规范化输出：`{ templates: items[]（含 name/description/scope/favourite/nick_name/create_time/user_name/steps/template.steps），total: total_size }`。**steps[].module_id 为全限定名**（如 `devcloud2018.codeci_action_20043.action`），可直接作为 create_job.steps 入参（白名单校验见组装器）。

> **模板来源区分（2026-09-23 用户澄清）**：`ListCustomTemplate`（v1 `/v1/template/custom`）查**用户自建模板**——本工具查询入口；`ListOfficialTemplate`（v1 `/v1/template/officialtemplates`）查官方模板——**仅作 step-templates.json 离线初始化数据源**，不在工具查询范围。create_job 模板化组装默认用 bundle 内打包的 step-templates.json（不依赖在线官方模板查询）。
