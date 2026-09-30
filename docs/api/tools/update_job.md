# 工具契约 — codeartsbuild_update_job

> **来源**: `docs/api/api-contract.md` §2.5（工具接口契约，唯一事实来源）

### 2.5 codeartsbuild_update_job

更新已有构建任务。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_update_job` |
| **场景** | C. 任务编排 |
| **描述** | 接口入参与 create 相同，另需原任务 jobId；**不支持增量修改**（全量覆盖提交） |
| **KooCLI 操作** | `UpdateNewJob`（POST，参数与 CreateNewJob 同构 + `job_id`） |
| **URL** | `/v1/job/update` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID（原任务，请求体 `job_id`） |
| body | object | ✅ | 与 create 同构的可修改配置片段（全量覆盖，非增量，含 arch/projectId/jobName/steps 等） |

**输出示例**（openapi 实测响应）：

```json
{
  "result": { "job_id": "db8467d972cc47f7a1bd2a3a3e77596a" },
  "error": null,
  "status": "success"
}
```

> 工具规范化输出：`{ job_id, updated: true }`。
