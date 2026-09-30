# 工具契约 — codeartsbuild_get_log

> **来源**: `docs/api/api-contract.md` §2.15（工具接口契约，唯一事实来源）

### 2.15 codeartsbuild_get_log

**获取构建日志（清洗建模）。仅 error 分析场景调用。**

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_get_log` |
| **场景** | G. 故障诊断 |
| **描述** | 基于 record_id 查询构建日志（全量） |
| **KooCLI 操作** | `DownloadBuildFullLog`（GET，log_level 可选 INFO\|DEBUG，实测） |
| **URL** | `/v1/log/{record_id}/download-log` |
| **调用约束** | 仅在构建失败或用户显式要求日志时调用 |

**输入参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| recordId | string | ✅ | — | 记录 ID（来自 get_record 的 `build_record_id`，36 位 UUID） |
| logLevel | string | ❌ | INFO | 日志等级（INFO\|DEBUG） |
| maxBytes | number | ❌ | 262144 | 日志截断上限（默认 256 KB） |

**输出示例**：

```json
{
  "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
  "record_id": "7f8c1d2e-...-36位uuid",
  "byte_size": 1572864,
  "truncated": true,
  "raw_sample": "[INFO] ...\n[ERROR] COMPILATION ERROR:\n...",
  "structured": [
    {
      "phase": "build",
      "level": "error",
      "content": "Demo.java:42: error: cannot find symbol",
      "line_range": [41, 43]
    }
  ],
  "error_summary": {
    "phase": "build",
    "error_type": "COMPILE_ERROR",
    "message": "cannot find symbol: method getDemo()",
    "line": 42,
    "context": "  return demo.getDemo();\n         ^"
  }
}
```

**大日志策略**：HEAD + TAIL + 错误上下文三区采样；`truncated=true` 时提示用户控制台查看全文。

> **ZIP 解压（实调用确认）**：`DownloadBuildFullLog` 返回内容为 **ZIP 压缩包**（PK 头，内含 `message.txt` 主日志），非纯文本——工具层须先解压再交由 log-cleaner 清洗（见 FE-02-日志清洗器规范-20260918.md §9 解压规约）。`record_id` 来自 `get_record` 的 `build_record_id`，与 `ListRecords.data[].id` 一致（实调用确认）。
