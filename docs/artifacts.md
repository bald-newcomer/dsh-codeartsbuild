# CodeArtsBuild 插件 — 构建产物规范

> **文档编号**: CAB-ARTIFACTS-001  
> **版本**: v0.1.0（草案）  
> **日期**: 2026-09-17  
> **状态**: 待评审  
> **前置依赖**: 接口契约 v0.4.5（`docs/api-contract.md` §2.12）

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-09-17 | 初始产物规范 |

---

## 1. 产物模型

### 1.1 云侧产物（list_artifacts）

`list_artifacts(jobId, buildNo)` 返回构建产物，每个产物含**双链接**：

```json
{
  "artifacts": [
    {
      "name": "demo-1.0.0.jar",
      "type": "jar",
      "size_bytes": 245760,
      "uri": "cloudartifact://demo-project/demo/1.0.0/demo-1.0.0.jar",
      "download_url": "https://artifact-api.../download?signature=xxx",
      "console_url": "https://console.huaweicloud.com/codearts/artifact/#/repository/demo-project/demo/1.0.0"
    }
  ],
  "job_id": "f9d6c8466d614a9788e9a0acf6c15f46",
  "build_no": 13
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 产物名称 |
| type | string? | 产物类型（jar/war/tgz/镜像 等） |
| size_bytes | number? | 大小（字节） |
| uri | string? | 制品仓库 URI |
| **download_url** | string | **下载链接**（带签名鉴权，短时效） |
| **console_url** | string | **页面查询链接**（控制台可打开，长期有效） |

> `ShowNewOutput`(v1 `/v1/job/{job_id}/{build_no}/output`) 返回 `package_info` / `image_info` / `obs_info` 三类；KooCLI 未封装，需手动调用（契约 §8 #2 待实调用确认字段结构）。

### 1.2 本地产物（repo_build）

`repo_build` 本地构建后收集：

```json
{
  "artifacts": [
    { "name": "demo-1.0.0.jar", "path": "target/demo-1.0.0.jar", "type": "jar", "size_bytes": 245760 }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 产物名称 |
| path | string | 仓库内相对路径 |
| type | string? | 产物类型 |
| size_bytes | number? | 大小（字节） |

---

## 2. 产物类型

| 类型 | 典型路径/模式 | 说明 |
|------|--------------|------|
| jar/war | `target/*.jar` / `build/libs/*.jar` | Java（Maven/Gradle） |
| tgz/zip | `dist/*.tgz` / `dist/*.zip` | npm/前端打包 |
| binary | `bin/*` | Go/编译产物 |
| wheel/sdist | `dist/*.whl` / `dist/*.tar.gz` | Python |
| 镜像 | `image` | Docker 镜像（SWR） |
| obs 对象 | `obs://bucket/key` | OBS 上传产物 |

---

## 3. 下载规范

| 项 | 规约 |
|----|------|
| 下载方式 | 用 `download_url`（带签名）直接下载；短时效失效后重新 `list_artifacts` 获取 |
| 页面查询 | 用 `console_url` 在浏览器查看（长期有效，可分享） |
| 凭据 | download_url 自带签名，无需额外凭据；**不在文档/日志中记录签名 URL 全文** |
| 大文件 | 本地产物下载（M2 规划）建议分片/断点续传 |
| 敏感产物 | 涉及源码包/私钥类产物需用户确认后下载 |

---

## 4. 留档

`repo_build` 本地构建产物与过程记录自动写入 `.codeartsbuild/build-records/`（见 repo-analyzer.md §6），供追溯与复用（recommended_steps 可作为 create_job 配置来源）。

---

## 5. 与契约一致性

| 契约条目 | 本文件落实 | 状态 |
|----------|-----------|------|
| 契约 §2.12 list_artifacts 双链接 | §1.1 对齐 | ✅ |
| 契约 §2.16 repo_build 产物 | §1.2 对齐 | ✅ |
| 契约 §8 #2 ShowNewOutput 待确认 | §1.1 标注 | ✅ |
