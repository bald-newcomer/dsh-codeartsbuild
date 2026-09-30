# 工具契约 — codeartsbuild_get_record

> **来源**: `docs/api/api-contract.md` §2.11（工具接口契约，唯一事实来源）

### 2.11 codeartsbuild_get_record

获取某条构建记录详情。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_get_record` |
| **场景** | E. 状态监控 / F. 产物管理 |
| **描述** | 按 jobId、buildNo 获取构建记录详情；含 `build_record_id`（构建记录查询）、`execution_id`（日志查询）、`devcloud_project_id`（project_id） |
| **KooCLI 操作** | `ShowJobBuildRecordDetail`（GET，实测） |
| **URL** | `/v1/record/{job_id}/{build_no}/record-info` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID |
| buildNo | number | ✅ | 构建编号 |

**输出示例**（实测响应）：

```json
{
  "status": "success",
  "error": null,
  "result": {
    "id": "eb9d73c7-61b3-4823-b476-a7c00c493b8a",
    "build_project_id": "31581e9f-5772-4053-a50c-d5690578c8fd",
    "build_record_id": "9d6169b9-022d-458c-9dc8-48cc94cc4083",
    "parent_record_id": null,
    "devcloud_project_id": "b4d3971c3988463b865f6f920846149e",
    "codeci_job_id": "68491d9bc97b4774adb93e29b46d2dc6",
    "user_id": "ae22fd035f354cfa8d82a3f1c8940446",
    "build_no": 532,
    "daily_build_num": "20221011.29",
    "execution_id": "j_YE1bu9Z7",
    "repo_name": "maven",
    "repo_id": "2111616838",
    "branch": "buildflow_env",
    "tag": null,
    "commit": null,
    "commit_message": null,
    "commit_create_time": "2022-10-11T08:28:42.000+00:00",
    "trigger_type": "MANUAL",
    "build_type": "branch",
    "status": "SUCCESS",
    "domain_id": "60021bab32fd450aa2cb89226f425e06",
    "create_time": "2022-10-11T08:28:42.000+00:00",
    "schedule_time": "2022-10-11T08:28:45.000+00:00",
    "queued_time": "2022-10-11T08:28:45.000+00:00",
    "start_time": "2022-10-11T08:28:47.000+00:00",
    "runnable_time": "2022-10-11T08:16:04.000+00:00",
    "finish_time": "2022-10-11T08:30:27.000+00:00",
    "duration": 100068,
    "record_status": null,
    "use_private_slave": 0,
    "region": "xx-xxxx-xx",
    "err_msg": null,
    "build_config_type": "YAML"
  }
}
```

> **字段用途**：`result.build_record_id` → 构建记录查询（record_id，供日志下载，与 `ListRecords.data[].id` 一致——实调用确认）；`result.execution_id` → 日志查询；`result.devcloud_project_id` → project_id。
