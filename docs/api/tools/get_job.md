# 工具契约 — codeartsbuild_get_job

> **来源**: `docs/api/api-contract.md` §2.3（工具接口契约，唯一事实来源）

### 2.3 codeartsbuild_get_job

获取单个构建任务的完整配置。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_get_job` |
| **场景** | A. 项目感知 / C. 任务编排 |
| **描述** | 按 jobId 查询构建任务详情；`steps` 为构建步骤（module_id 全限定名），`scms` 为构建代码仓，`parameters` 为构建参数（双层结构） |
| **KooCLI 操作** | `ShowJobConfig`（GET） |
| **URL** | `/v1/job/{job_id}/config` |

**输入参数**（openapi.yaml 定义）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| jobId | string | ✅ | 构建任务 ID（path） |
| getAllParams | string | ❌ | 是否返回完整参数（query `get_all_params`，true/false） |

**输出示例**（openapi 实测响应，QueryJobConfigResponseBody）：

```json
{
  "result": {
    "steps": [
      { "module_id": "devcloud2018.codeci_action_20028.action", "name": "使用SWR公共镜像", "version": null, "enable": false, "properties": null }
    ],
    "arch": "x86-64",
    "project_id": "a287e712be6c404ca26e5f69040fa12b",
    "job_name": "oychap213i2",
    "job_id": "9f49a70d6e234d77a5018504cb9e325",
    "auto_update_sub_module": "false",
    "flavor": "2u8g",
    "parameters": [
      {
        "name": "hudson.model.StringParameterDefinition",
        "params": [{ "name": "name", "value": "clusterEum" }, { "name": "type", "value": "customizeparam" }]
      }
    ],
    "scms": [
      {
        "branch": "master",
        "url": "git@codehub.devcloud.{region}.huawei.com:soso-test00001/an.git",
        "scm_type": "codehub",
        "repo_id": "2111746211",
        "build_type": "branch",
        "build_commit_id": "5cb9180bedf25e8c103d30cb0c924a4107336b06"
      }
    ],
    "host_type": "custom_host",
    "build_config_type": "ACTION",
    "source_code": "codeci"
  },
  "error": null,
  "status": "success"
}
```

> 字段映射：`result.steps[].module_id` 为全限定名；`result.scms[].scm_type` 实测 `codehub`；`result.arch` 实测 `x86-64`。工具规范化输出保留 result 主体（camelCase 转换）。
