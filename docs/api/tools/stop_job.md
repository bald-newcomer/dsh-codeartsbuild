# 工具契约 — codeartsbuild_stop_job

> **来源**: `docs/api/api-contract.md` §2.8（工具接口契约，唯一事实来源）

### 2.8 codeartsbuild_stop_job

停止运行中的构建。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_stop_job` |
| **场景** | D. 执行控制 |
| **描述** | 按 jobId、buildNo 停止任务 |
| **KooCLI 操作** | `StopTheJob`（POST） |
| **URL** | `/v1/job/{job_id}/stop` |

**输入参数**（openapi.yaml `StopTheJobRequestBody`）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID（path） |
| buildNo | number | ✅ | 构建编号（请求体 `build_no`，停止指定一次构建） |

**输出示例**（openapi 实测响应）：

```json
{ "status": "success" }
```

> 工具规范化输出：`{ job_id, build_no, stopped: true }`。**原始响应无 job_id/build_no**，由工具层回填入参。**请求体 `{build_no}` 实调用确认**：传 `--build_no` 返回业务错误 DEVCB.00030000（参数传递正确，构建已结束故停止失败）。
