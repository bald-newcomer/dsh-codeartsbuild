# 工具契约 — codeartsbuild_delete_job

> **来源**: `docs/api/api-contract.md` §2.6（工具接口契约，唯一事实来源）

### 2.6 codeartsbuild_delete_job

删除构建任务。**不可逆，调用前必须与用户确认**。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_delete_job` |
| **场景** | C. 任务编排 |
| **描述** | 按 jobId 删除任务；不可逆 |
| **KooCLI 操作** | `DeleteTheJob`（**DELETE**，openapi 实测为 HTTP DELETE） |
| **URL** | `/v1/job/{job_id}/delete` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID（path） |

**输出示例**（openapi 实测响应）：

```json
{
  "result": { "project_id": "b4d3971c3988463b865f6f920846149e", "job_id": "c798139500d2456d82d95d108f182b5a" },
  "error": null,
  "status": "success"
}
```

> 工具规范化输出：`{ job_id, deleted: true }`（从 `result.job_id` 提取）。**HTTP DELETE 实调用确认**：hcloud help `Method: DELETE`，无 body，job_id 为 path 参数。
