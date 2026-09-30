# 工具契约 — codeartsbuild_list_jobs

> **来源**: `docs/api/api-contract.md` §2.2（工具接口契约，唯一事实来源）

### 2.2 codeartsbuild_list_jobs

列出构建任务列表（**全局**，不按项目过滤——ListJob 无 project_id 参数）。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_list_jobs` |
| **场景** | A. 项目感知 |
| **描述** | 全局构建任务搜索；`search` 为核心按任务名称搜索字段；响应 `result.job_list[].id` 即 jobId |
| **KooCLI 操作** | `ListJob`（GET） |
| **URL** | `/v1/job/list` |

**输入参数**（openapi.yaml 定义）：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| pageIndex | number | ❌ | 0 | 分页页码（page_index ≥ 0，≤1e9） |
| pageSize | number | ❌ | 10 | 每页条数（page_size ≤100） |
| search | string | ❌ | — | **核心搜索字段**：按任务名称关键字搜索 |
| buildStatus | string | ❌ | — | 构建状态过滤，**枚举 aborted\|InQueue\|building\|red\|blue\|none** |
| sortField | string | ❌ | — | 排序字段 |
| sortOrder | string | ❌ | — | 排序方式（ASC\|DESC） |
| creatorId | string | ❌ | — | 创建者用户 ID（可从响应 job_creator 获取） |

> 注：原契约的 `projectId` 参数移除——实测 `ListJob` 无项目维度参数。若需项目维度筛选，可先 `list_projects` 后用 `search` 或按返回的 project 字段过滤。

**输出示例**（openapi 实测响应）：

```json
{
  "result": {
    "total": 20697,
    "job_list": [
      {
        "id": "8f4fb54a55c744beb8967cf50d96d87b",
        "job_name": "APITest-JobList-running-2kDRoU",
        "job_creator": "ae22fd035f354cfa8d82a3f1c8940446",
        "user_name": "testUser",
        "project_id": "6823252f543d4915b49892a5fd9f0ec3",
        "project_name": "CodeCIServer—API测试01",
        "last_build_time": 1727041445000,
        "last_build_status": "aborted",
        "last_job_running_status": "Finished",
        "is_finished": true,
        "disabled": false,
        "scm_type": "codehub",
        "build_number": "1",
        "build_project_id": "8597a528-068e-4bfa-a812-3c625060c007"
      }
    ]
  },
  "status": "success"
}
```

> 字段映射：`result.job_list[].id` → jobId；`last_build_time` 为毫秒时间戳（适配层转 ISO）；**last_build_status 实测含 `aborted`**（映射规则见契约 §4.1：aborted→CANCELED）。
