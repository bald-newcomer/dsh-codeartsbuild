# Step 模板库（create_job 组装用）

> step-templates.json 的模板 id（`template_id`）与默认 properties 摘要。完整默认值以 bundle 内打包的 `step-templates.json` 为准（create_job 组装器自动载入）；本文档供设计 stepsPlan / 覆写 properties 时参考。

## 常用 step 模板清单

| template_id | name | module_id（uuid） | 关键默认 properties | 可用值枚举（image_select 等） |
|-------------|------|-------------------|---------------------|------------------------------|
| `maven-build` | Maven构建 | `devcloud2018.codeci_action_20043.action` | image=maven3.5.3-jdk8-open, command=`mvn package -Dmaven.test.skip=true -U -e -X -B`, cacheOption=cached | image_select: maven3.5.3-jdk8-open ~ maven3.9.9-jdk21（9 个） |
| `gradle-build` | Gradle构建 | `devcloud2018.codeci_action_20008.action` | gradle=4.8, jdk=1.8, command1/command2（gradlew build） | gradle_select: 2.13~8.10.2（37 个）; jdk_select: 1.7~21（12 个） |
| `android-build` | Android构建 | `devcloud2018.codeci_action_20032.action` | gradle=4.8, jdk=1.8, ndk=不使用, command1（gradlew assembleDebug） | gradle_select: 2.13~8.10.2; jdk_select: 1.7~21; ndk_select: 16~25（10 个） |
| `npm-build` | npm构建 | `devcloud2018.codeci_action_20014.action` | image=nodejs12.7.0, command（npm install + npm run build，走华为云镜像） | **image_select: nodejs8.11.2 ~ nodejs24（13 个）** |
| `pyinstaller-build` | PyInstaller构建 | `devcloud2018.codeci_action_20015.action` | image=python3.6, command（pip 装 pyinstaller + 打包） | image_select: python2.7 ~ python3.12（9 个） |
| `go-build` | Go语言构建 | `devcloud2018.codeci_action_20026.action` | image=go-1.10.3, command（go build ./...，GOPROXY 华为云） | image_select: go-1.10.3 ~ go-1.26（15 个） |
| `php-build` | PHP构建 | `devcloud2018.codeci_action_20037.action` | image=php7.3.3, command（composer install，华为云镜像） | image_select: php5.6.40 ~ php8.4（6 个） |
| `cmake-build` | CMake构建 | `devcloud2018.codeci_action_20005.action` | image=cmake3.10.1-gcc5.5.0, command（mkdir build && cmake && make） | image_select: cmake2.8.12-gcc4.8.5 ~ cmake3.26.5-gcc13.1.0（12 个） |
| `shell-command` | 执行shell命令 | `devcloud2018.codeci_action_20017.action` | image=shell4.2.46-git1.8.3-zip6.00, command=`echo 'hello'`（**必须覆盖**为实际命令） | image_select: shell4.2.46-git1.8.3-zip6.00（仅 1 个） |
| `upload-release` | 上传软件包到软件发布库 | `devcloud2018.codeci_action_20018.action` | file=`**/target/*.?ar`（按项目改，npm 常配 `**/dist/*`）, remainOriginPath=FLAT | — |
| `build-image-swr` | 制作镜像并推送到SWR | `devcloud2018.codeci_action_20004.action` | image=docker18.03, imageName/tag/organization（必填，按项目改）, registryUrl=swr.cn-north-4.myhuaweicloud.com | image_select: docker18.03/20.10/29.10（3 个） |
| `upload-obs` | 上传文件到OBS | `devcloud2018.codeci_action_20057.action` | backetName（必填，OBS 桶名）, artifactSourcePath=bin/* | authorizationUser_select: current/other |
| `download-obs` | 从OBS下载文件 | `devcloud2018.codeci_action_20063.action` | bucketName/objectKey（必填） | authorizationUser_select: current/other |
| `unit-report` | 单元测试报告 | `devcloud2018.codeci_action_20071.action` | unit_type/file/junitCoverageSwitch | unit_type_select: junit; coverageFormat_select: jacoco/cobertura |

> 说明：
> - `{param}_select` 字段（如 `image_select`、`gradle_select`、`jdk_select`）是**可用值枚举**，仅供模型参考选版本——**不进入请求体**（组装器自动剥离）。覆写 `image` 等参数时须从对应 `_select` 数组中取值，**禁止臆造不在列表内的版本号**（FE-11：曾发生模型臆造 `nodejs16.13.0` 致服务端报"镜像不存在"）。
> - **`_select` 值是服务端字面量，照抄勿补全**（FE-12 P5，2026-10-11）：`image_select` 里的 `nodejs20` 是**镜像标识符字面量**，不是"Node 20 的缩写"——**原样抄写，禁止补全/加补丁号/变体**（`nodejs20` 不要写成 `nodejs20.18.0`，实测细粒度版本不存在致构建调度失败）。校验器会拦臆造值并推荐最接近的字面量（如臆造 `nodejs20.18.0` → 推荐 `nodejs20`）。
> - **机制层校验**（2026-10-10，FE-11 §6.1）：create_job 组装器已校验 `image` 必须在对应模板 `image_select` 内（无 `image_select` 的模板禁止覆盖 image）——臆造镜像直接 E_PARAM 拦截，不再透传到服务端。可用值见上表。
> - `language` 组合表见 language-combinations.md（`maven-build` 等 template_id 与 module_id 可互换使用）。
> - `upload-release` 的 `file` 是产物通配，**按项目修改**（Maven 配 `**/target/*.?ar`，npm 常配 `**/dist/*`，action 默认 `bin/*`）。
> - `build-image-swr` 的 `imageName`/`tag`/`dockerFilePath`/`organization` 为必填，按项目改。
> - module_id 白名单约束见 language-combinations.md「module_id 白名单」。

## 官方模板查询职责

- **`list_templates` 仅查用户自定义模板**（`ListCustomTemplate`，`/v1/template/custom`），用于创建任务前检查"是否有用户已自建的、可直接使用的模板"。
- **官方模板不通过工具查询**——create_job 组装直接用 bundle 内打包的 step-templates.json（`language` 组合或 `stepsPlan`）。
- 创建任务流程：**先 `list_templates` 查自定义模板**（有匹配 → 参考/直接用其 steps；无匹配 → 用本地 `language` 组合或 `stepsPlan`）。空结果不应视为"无可用模板"，应回退本地语言组。
