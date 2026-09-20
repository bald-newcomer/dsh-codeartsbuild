# CodeArtsBuild 插件 — 构建产物规范

> **文档编号**: CAB-ARTIFACTS-001  
> **版本**: v0.2.2（迭代由用户决定）  
> **日期**: 2026-09-18  
> **状态**: 待评审  
> **前置依赖**: 接口契约（`docs/api/api-contract.md` §2.12）

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-17 | 初始产物规范 |
| v0.2.0 | 2026-09-17 | **统一产物结构体**：type 按介质区分（obs/image/artifact/local）；新增 record_id、language 字段；下载策略调整——当前版本不提供下载（download_url 需 token），仅提供 console_url 跳转查看 |
| v0.2.1 | 2026-09-18 | **openapi 字段对齐**：ShowNewOutput 响应字段改 `package_infos`/`image_infos`（条目 type 枚举 package/image）；`obs` 类型标记为待实测确认（openapi 无 obs 字段） |
| v0.2.2 | 2026-09-18 | **OBS step 闭环**：OBS 交付经构建步骤 `20057`（上传）/ `20063`（下载）实现，ShowNewOutput 仍无 obs 字段；`obs` 类型保留（预留） |

---

## 1. 统一产物结构体

**云侧与本地产物使用同一规范结构体**，以 `type`（介质）区分来源：

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

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ | 产物名称 |
| **type** | string | ✅ | **介质类型**：`obs` / `image` / `artifact` / `local`（见 §2） |
| **language** | string | ❌ | **语言类型**（Java / Go / JavaScript / Python 等），本地/云侧均可带 |
| **record_id** | string | ❌ | **关联构建记录 ID**（`get_record` 的 `build_record_id`），用于追溯产物来源 |
| size_bytes | number | ❌ | 大小（字节） |
| uri | string | ❌ | 产物定位（制品仓库 URI / OBS URI / 本地相对路径） |
| console_url | string | ❌ | 页面跳转链接（控制台，**当前版本唯一提供的查看方式**） |

---

## 2. 产物类型（按介质区分）

| type | 介质 | 对应 ShowNewOutput 输出 | 典型示例 | 说明 |
|------|------|------------------------|----------|------|
| `artifact` | 制品（软件包） | `package_infos`（条目 type=package） | jar / war / tgz / zip / wheel | 制品仓库中的构建包 |
| `image` | 容器镜像 | `image_infos`（条目 type=image） | Docker 镜像（SWR） | 镜像地址 + tag |
| `obs` | OBS 对象 | 待实测确认（openapi 无 obs 字段） | 上传到 OBS 的产物文件 | OBS URI（是否支持待确认） |
| `local` | 本地文件（repo_build） | —（本地收集） | target/*.jar / dist/* | **本地产物统一用 `local`**，不细分 jar/war 等（语言类型由 `language` 字段表达） |

> **type 语义**：`type` 只表达**存储介质**，不表达文件格式。文件格式（jar/war/tgz）由 `name` 后缀或 `language` 间接体现。
>
> **注意（2026-09-18 openapi 对齐 + action 定义确认）**：`ShowNewOutput` 实际响应为 `package_infos`/`image_infos`（数组）与单数 `package_info`（单个对象），**无 `obs_info`**；`obs` 类型保留在结构体中（预留）。**OBS 交付经构建步骤实现**：`codeci_action_20057`（上传 OBS 对象）/ `20063`（下载 OBS 对象）——产物上传 OBS 桶后经 console_url 查看，ShowNewOutput 不返回 obs 字段（契约 §8 #2，step-templates.md §3.4/§3.5）。

---

## 3. 云侧产物（list_artifacts）

`list_artifacts(jobId, buildNo)` 经 `ShowNewOutput`（v1 `/v1/job/{job_id}/{build_no}/output`）返回产物，映射为：

| ShowNewOutput 分组 | type | 说明 |
|-------------------|------|------|
| `package_infos[]`（条目 type=package） | `artifact` | 制品包（jar/war/tgz 等） |
| `image_infos[]`（条目 type=image） | `image` | 容器镜像（SWR） |
| `obs_infos[]`（openapi 无，待确认） | `obs` | OBS 上传对象（预留） |

**示例（artifact）**：

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

**示例（image）**：

```json
{
  "artifacts": [
    {
      "name": "demo-image",
      "type": "image",
      "language": null,
      "record_id": "7f8c1d2e-...-36位uuid",
      "size_bytes": null,
      "uri": "swr.cn-north-4.myhuaweicloud.com/demo/demo-image:1.0.0",
      "console_url": "https://console.huaweicloud.com/swr/#/app/demo/demo-image"
    }
  ],
  "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
  "build_no": 13
}
```

> `ShowNewOutput` 具体字段结构（`package_infos`/`image_infos`，条目 type 枚举 package/image）以实调用确认为准（契约 §8 #2）。

---

## 4. 本地产物（repo_build）

`repo_build` 本地构建后收集，**统一 `type: local`**，与云侧产物共用结构体：

```json
{
  "artifacts": [
    {
      "name": "demo-1.0.0.jar",
      "type": "local",
      "language": "Java",
      "record_id": "2026-09-16_100000",
      "size_bytes": 245760,
      "uri": "target/demo-1.0.0.jar"
    }
  ]
}
```

| 差异点 | 说明 |
|--------|------|
| type | 固定 `local`（不细分 jar/war——文件格式由 `name` 后缀表达） |
| uri | 仓库内**相对路径**（替代云侧的仓库 URI） |
| record_id | 本地留档 ID（`.codeartsbuild/build-records/` 记录 ID） |
| console_url | 无（本地文件无需页面跳转）；如需跳转由上层流程处理 |

> **评估结论**：本地产物直接使用 `type: local` 即可——统一结构体，仅介质标识不同，避免为本地单独建模型。

---

## 5. 下载规范（当前版本）

| 项 | 规约 |
|----|------|
| **下载能力** | **当前版本不提供下载**——`download_url` 需携带 token（X-Auth-Token），不暴露给用户/模型 |
| **查看方式** | **仅提供 `console_url`** 支持用户跳转控制台查看（长期有效，无需 token） |
| **大文件** | 当前版本不支持大文件下载；M2 规划实现带 token 的分片下载 |
| **敏感产物** | 涉及源码包/私钥类产物，仅给 console_url，提示用户控制台自行评估 |

> **决策**：产物交付当前只到"链接可跳转查看"级别；实际文件下载留待 M2（需实现 token 获取与传输，见架构 §11 演进路线）。

---

## 6. 留档

`repo_build` 本地构建产物与过程记录自动写入 `.codeartsbuild/build-records/`（见 design/repo-analyzer.md §6），`record_id` 即留档记录 ID，供追溯与复用。

---

## 7. 与契约一致性

| 契约条目 | 本文件落实 | 状态 |
|----------|-----------|------|
| 契约 §2.12 list_artifacts | §3 对齐（type 按介质映射） | ✅ |
| 契约 §2.16 repo_build 产物 | §4 对齐（type: local 统一结构体） | ✅ |
| 契约 §8 #2 ShowNewOutput 待确认 | §3 标注 | ✅ |
| 下载策略（当前不下载） | §5 对齐 | ✅ |
