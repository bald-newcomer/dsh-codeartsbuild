# 工具契约 — codeartsbuild_wait_build

> **来源**: `docs/api/api-contract.md` §2.14（工具接口契约，唯一事实来源）

### 2.14 codeartsbuild_wait_build

轮询等待构建进入终态。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_wait_build` |
| **场景** | E. 状态监控 |
| **描述** | 按 jobId、buildNo 查询任务状态并轮询直至终态 |
| **KooCLI 操作** | 内部循环调用 `ShowJobStepStatus` |
| **URL** | `/v1/job/{job_id}/status` |

**输入参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| jobId | string | ✅ | — | 构建任务 ID |
| buildNo | number | ✅ | — | 构建编号 |
| intervalMs | number | ❌ | 10000 | 初始轮询间隔（2000~120000） |
| timeoutMs | number | ❌ | 1800000 | 总超时阈值（默认 30 分钟；范围 60000~7200000） |
| maxBackoffMs | number | ❌ | 30000 | 退避上限（见"轮询策略"） |

**轮询策略**：

| 项 | 规约 |
|----|------|
| 初始间隔 | `intervalMs`（默认 10s） |
| **退避策略** | 指数退避：每次轮询间隔 ×1.5，上限 `maxBackoffMs`（默认 30s）；用于长时间未终态时降低 API 压力 |
| **总超时阈值** | `timeoutMs`（默认 30 分钟，上限 2 小时）；超时即中止轮询 |
| **超时后行为** | 返回 `status=TIMEOUT` + 最后一次已知状态（`last_status`/`last_start_time`），**不抛异常**，由 LLM 决策后续（继续 get_status 或升级用户） |
| 终态判定 | `SUCCESS` / `FAILED` / `ERROR` / `CANCELED` / `COMPLETED` 任一即停 |
| 网络抖动 | 单次查询失败（网络错误）重试 ≤2 次（间隔 2s），不影响退避计数；**连续 3 轮网络失败才抛 E_NETWORK**，单轮抖动继续轮询 |
| **终态复核** | `completed` + `workflow.error` 非取消类（2026-09-21 实测：error 可能瞬态，日志 `Finished: SUCCESS` 但 error 有值）→ 调 `ShowJobBuildRecordDetail`（`/v1/record/{job_id}/{build_no}/record-info`）复核权威终态；取消类 error（reason 含 取消/abort/cancel）→ 直接 CANCELED |

**输出示例**：

```json
{
  "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
  "build_no": 13,
  "status": "FAILED",
  "start_time": "2026-09-15T10:30:00Z",
  "end_time": "2026-09-15T10:35:20Z"
}
```

**超时输出示例**：

```json
{
  "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
  "build_no": 13,
  "status": "TIMEOUT",
  "last_status": "RUNNING",
  "last_start_time": "2026-09-15T10:30:00Z",
  "elapsed_ms": 1800000
}
```

> **轮询依据（实调用确认）**：`ShowJobStepStatus` 返回 `result.workflow.status`（实测 `running`）+ `result.flow`（步骤状态对象，含 external_pre_checkout/initial/state_N 等阶段）+ `result.label`。状态映射见契约 §4.1。

**行为**：终态立即返回；超时返回 `TIMEOUT`（非异常，见上）；`status=FAILED` 时 LLM 继续走 G2（`get_log` → 清洗 → 分析）。
