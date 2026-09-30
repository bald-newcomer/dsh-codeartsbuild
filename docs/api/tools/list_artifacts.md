# 工具契约 — codeartsbuild_list_artifacts

> **来源**: `docs/api/api-contract.md` §2.12（工具接口契约，唯一事实来源）

### 2.12 codeartsbuild_list_artifacts

列出某次构建产生的产物（**软件包产物 / 镜像产物**）。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_list_artifacts` |
| **场景** | F. 产物管理 |
| **描述** | 按 jobId、buildNo 查询产物信息；产物分为软件包产物（package_infos）、镜像产物（image_infos）两类（openapi 实测）；OBS 产物经构建 step `20057`/`20063` 交付（见 FE-04-Step模板库拆解-20260918.md），响应无 obs 字段 |
| **承载** | `ShowNewOutput` 经自建 HTTP（AK/SK 签名，`GET /v1/job/{job_id}/{build_no}/output`）调用——**该接口未封装于 KooCLI**，自建 HTTP 承载后与普通工具同构 |
| **URL** | `/v1/job/{job_id}/{build_no}/output` |

**输入参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID |
| buildNo | number | ✅ | 构建编号 |

**输出示例**（openapi 实测响应，OutPutInfo）：

```json
{
  "result": {
    "package_infos": [
      {
        "project_id": "cdaffd3a058b43db948d49c946e1021a",
        "name": "README.md",
        "version": "20260323.1",
        "package_type": "md",
        "uri": null,
        "type": "package",
        "group": null,
        "swr_organization": null,
        "swr_uri": null,
        "swr_tag": null,
        "history_id": null,
        "daily_build_number": "20260323.1"
      }
    ],
    "image_infos": [],
    "user_properties": { "build_version": "1.0.0" }
  },
  "error": null,
  "status": "success"
}
```

> **字段说明**（OutPutResult）：`type` 枚举 `image`（镜像）/`package`（软件包）；`package_type` 枚举 cmake/jar/py/zip/txt/yml/html；`uri` 产物路径；`daily_build_number` 每日构建编号。响应还有单数 `package_info`（单个对象）字段（OutPutInfo 定义含两者，实测返回数组 `package_infos`）。**无 obs 字段**——OBS 产物交付经构建 step（上传 `20057` / 下载 `20063`）实现，产物查看走 console_url（实调用确认）。

**规范化产物输出**（工具层将原始响应映射为统一结构体，见 operations/artifacts.md §1）：

```json
{
  "artifacts": [
    {
      "name": "demo-1.0.0.jar",
      "type": "artifact",
      "language": "Java",
      "record_id": "7f8c1d2e-...-36位uuid",
      "size_bytes": 245760,
      "uri": "cloudartifact://demo-project/demo/1.0.0/demo-1.0.0.jar",
      "console_url": "https://console.huaweicloud.com/codearts/artifact/#/repository/demo-project/demo/1.0.0"
    }
  ],
  "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
  "build_no": 13
}
```

**下载策略（当前版本）**：不提供下载（download_url 需 token），仅返回 `console_url` 支持用户跳转控制台查看；大文件下载 M2 规划（见 operations/artifacts.md §5）。
