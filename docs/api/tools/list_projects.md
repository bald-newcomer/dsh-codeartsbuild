# 工具契约 — codeartsbuild_list_projects

> **来源**: `docs/api/api-contract.md` §2.1（工具接口契约，唯一事实来源）

### 2.1 codeartsbuild_list_projects

获取当前用户可见的 CodeArts 项目列表。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_list_projects` |
| **场景** | A. 项目感知 |
| **描述** | 无参，返回当前用户下有权限的项目列表；响应中 `identifier` 即 projectId，`name` 即 projectName |
| **KooCLI 操作** | `ShowRelatedProject`（GET） |
| **URL** | `/v1/domain/project/related` |

**输入参数**：无

**输出示例**（实测响应）：

```json
{
  "result": {
    "total": 10,
    "project_info_list": [
      {
        "identifier": "3xx235c31ae44fb4bb410d875b750xxd",
        "name": "测试开发项目",
        "status": null,
        "author_id": "6dxx54d45bf44a0684a7a682f719xxd9",
        "is_creator": true,
        "author_domain_id": "764xx3980afc4e5c97a1a9a73c1dxx7a"
      }
    ]
  },
  "error": null,
  "status": "success"
}
```

> 字段映射：`result.project_info_list[].identifier` → projectId，`name` → projectName。
