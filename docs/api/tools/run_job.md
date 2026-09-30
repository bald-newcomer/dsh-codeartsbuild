# 工具契约 — codeartsbuild_run_job

> **来源**: `docs/api/api-contract.md` §2.7（工具接口契约，唯一事实来源）

### 2.7 codeartsbuild_run_job

触发构建任务执行。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_run_job` |
| **场景** | D. 执行控制 |
| **描述** | 按 jobId 执行任务，可动态传参（构建参数、仓库信息）；执行成功返回 buildNo |
| **KooCLI 操作** | `ExecuteJob`（POST） |
| **URL** | `/v1/job/execute` |

**输入参数**（openapi.yaml `RunJobRequestBody`）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID（请求体 `job_id`） |
| parameter | array | ❌ | 参数覆盖，`[{name, value}]`（**字段名为单数 `parameter`**，name/value 必填；name 长度 ≤128，value ≤8192） |
| scm | object | ❌ | 仓库信息，`Scm` 定义：`build_commit_id?` / `build_tag?` / `branch?` / `build_type?`(branch\|tag\|commitId) / `repo_id?` / `repo_name?` |

> **分支指定方式（实调用确认）**：`ExecuteJob` 的 openapi `Scm` 定义含 `branch` 字段，但 **KooCLI/服务端不支持 scm.branch**（hcloud 封装仅 `--scm.build_commit_id`/`--scm.build_tag`）；分支须经 `parameter` 传入（如 `{name: "codeBranch", value: "develop"}`，实测生效）或使用任务默认分支。

**输出示例**（openapi 实测响应）：

```json
{
  "result": {
    "octopus_job_name": "f9d6c8466d614a9788e9a0acf6c15f46",
    "actual_build_number": "20",
    "daily_build_number": "20200612.20"
  },
  "error": null,
  "status": "success"
}
```

> 工具规范化输出：`{ job_id: octopus_job_name, buildNo: Number(actual_build_number), daily_build_no: daily_build_number }`。**无 status 字段**（构建后状态需 get_status / wait_build 查询）。
