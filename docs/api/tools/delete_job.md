# 工具契约 — codeartsbuild_delete_job

> **来源**: `docs/api/api-contract.md` §2.6（工具接口契约，唯一事实来源）

### 2.6 codeartsbuild_delete_job

删除构建任务。**不可逆，缺省返回 `need_confirmation` 不删除**——须用户显式确认后携 `confirm=true` 才执行（FE-15 机制化，2026-10-23 会话 63534983）。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_delete_job` |
| **场景** | C. 任务编排 |
| **描述** | 按 jobId 删除任务；不可逆；`confirm` 缺省 false → 返回 `need_confirmation` + 引导，**不执行删除** |
| **KooCLI 操作** | `DeleteTheJob`（**DELETE**，openapi 实测为 HTTP DELETE） |
| **URL** | `/v1/job/{job_id}/delete` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID（path） |
| confirm | boolean | ❌ | 用户显式确认删除（默认 false；**true 才执行不可逆删除**——模型层不得未经用户确认直接删除，FE-15） |

**输出示例**（未确认，缺省）：

```json
{
  "deleted": false,
  "need_confirmation": true,
  "next_actions": ["删除不可逆，请向用户确认后携带 confirm=true 重试"]
}
```

**输出示例**（确认后成功，openapi 实测响应）：

```json
{
  "result": { "project_id": "b4d3971c3988463b865f6f920846149e", "job_id": "c798139500d2456d82d95d108f182b5a" },
  "error": null,
  "status": "success"
}
```

> 工具规范化输出：`{ job_id, deleted: true }`（从 `result.job_id` 提取）。**HTTP DELETE 实调用确认**：hcloud help `Method: DELETE`，无 body，job_id 为 path 参数。
