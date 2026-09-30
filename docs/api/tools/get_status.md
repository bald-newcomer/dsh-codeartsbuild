# 工具契约 — codeartsbuild_get_status

> **来源**: `docs/api/api-contract.md` §2.9（工具接口契约，唯一事实来源）

### 2.9 codeartsbuild_get_status

查询构建运行状态。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_get_status` |
| **场景** | E. 状态监控 |
| **描述** | 按 jobId、buildNo 查询任务状态；返回单值 `result.status`（STARTED/SUCCESS/FAILED，映射见 §4.1），易解析 |
| **KooCLI 操作** | `ShowJobBuildRecordDetail`（GET，实测）——**评审决策（2026-09-18）：替换原 `ShowJobStepStatus`**（workflow.status 需结合 flow/error 解析，较难；且 `ShowRunningStatus` 仅查最新构建无法按 buildNo 查询） |
| **URL** | `/v1/record/{job_id}/{build_no}/record-info` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID（path） |
| buildNo | number | ✅ | 构建编号（path） |

**输出示例**（实测响应）：

```json
{
  "status": "success",
  "error": null,
  "result": {
    "status": "SUCCESS",
    "build_no": 532,
    "duration": 100068,
    "start_time": "2022-10-11T08:28:47.000+00:00",
    "finish_time": "2022-10-11T08:30:27.000+00:00"
  }
}
```

> 工具规范化输出：`{ job_id, build_no, status: 映射后统一枚举（§4.1），start_time?, end_time?, duration_ms? }`。**状态在 `result.status`**（实测 STARTED/SUCCESS/FAILED），映射：STARTED→RUNNING、SUCCESS/FAILED 直映；其余状态（ERROR/CANCELED）以 ListRecords 查询兜底。`ShowJobStepStatus`（v1）保留供 `wait_build` 轮询使用（含 workflow.flow 子步骤详情）。
