# 工具契约 — codeartsbuild_list_records

> **来源**: `docs/api/api-contract.md` §2.10（工具接口契约，唯一事实来源）

### 2.10 codeartsbuild_list_records

列出构建任务的历史记录。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_list_records` |
| **场景** | E. 状态监控 |
| **KooCLI 操作** | `ListRecords`（GET） |
| **URL** | `/v1/record/{build_project_id}/records` |

**输入参数**（openapi.yaml 定义：build_project_id 为 path 必填；分页为 `page`+`limit`，非 offset）：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| buildProjectId | string | ✅ | — | 项目 ID（path，`build_project_id`） |
| page | number | ❌ | 1 | 分页页码（≥0） |
| limit | number | ❌ | 10 | 每页条数（1~100） |
| triggers | array | ❌ | — | 触发类型过滤（MANUAL 等） |
| branches | array | ❌ | — | 分支列表过滤 |
| tags | array | ❌ | — | 标签列表过滤 |
| fromDate | string | ❌ | — | 起始时间（yyyy-MM-dd HH:mm:ss） |
| toDate | string | ❌ | — | 结束时间（yyyy-MM-dd HH:mm:ss） |

**输出示例**（openapi 实测响应）：

```json
{
  "result": {
    "pagination": { "page": 0, "limit": 10, "total": -1 },
    "data": [
      {
        "id": "534488f1-8f08-4e2b-9bbb-9f3f20e0708e",
        "status": "ABORTED",
        "duration": 0,
        "parameters": [{ "name": "codeBranch", "secret": false, "value": "master" }],
        "repository": "https://codehub.devcloud.{region}.huawei.com:6823252f543d4915b49892a5fd9f0ec3/APITestCreateMaven02.git",
        "branch": "master",
        "status_code": 8,
        "create_time": "2024-06-26T08:25:09.000+00:00",
        "start_time": "2024-06-26T08:25:09.000+00:00",
        "finish_time": "2024-06-26T08:25:26.000+00:00",
        "execution_id": "j_VCcmey1D",
        "build_no": "2",
        "trigger_type": "MANUAL",
        "scm_type": "codehub",
        "project_id": "a3270d84-ddc7-4288-b985-f801871b260d"
      }
    ]
  },
  "error": null,
  "status": "success"
}
```

> 工具规范化输出：`{ records: data[]（camelCase 映射，build_no→buildNo）, total: pagination.total }`。注意：**openapi 实测记录含 `ABORTED` 状态**（映射规则见契约 §4.1：ABORTED→CANCELED）。

> **待确认（契约 §8 #11）**：2026-09-21 Layer 2 实调发现——用某任务 build_project_id 调 ListRecords 返回 `total=-1, records=[]`，而该任务确有构建记录，build_project_id 口径可能与 ListJob 返回值不一致，待进一步确认。
