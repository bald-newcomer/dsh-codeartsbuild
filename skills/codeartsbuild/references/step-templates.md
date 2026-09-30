# Step 模板库（create_job 组装用）

> step-templates.json 的模板 id（`template_id`）与默认 properties 摘要。完整默认值以 bundle 内打包的 `step-templates.json` 为准（create_job 组装器自动载入）；本文档供设计 stepsPlan / 覆写 properties 时参考。

## 常用 step 模板清单

| template_id | name | module_id（uuid） | 关键默认 properties |
|-------------|------|-------------------|---------------------|
| `maven-build` | Maven构建 | `devcloud2018.codeci_action_20043.action` | image=maven3.5.3-jdk8-open, command=`mvn package -Dmaven.test.skip=true -U -e -X -B`, cacheOption=cached |
| `gradle-build` | Gradle构建 | `devcloud2018.codeci_action_20008.action` | gradle=4.8, jdk=1.8, command1/command2（gradlew build） |
| `android-build` | Android构建 | `devcloud2018.codeci_action_20032.action` | gradle=4.8, jdk=1.8, ndk=不使用, command1（gradlew assembleDebug） |
| `npm-build` | npm构建 | `devcloud2018.codeci_action_20014.action` | image=nodejs12.7.0, command（npm install + npm run build，走华为云镜像） |
| `pyinstaller-build` | PyInstaller构建 | `devcloud2018.codeci_action_20015.action` | image=python3.6, command（pip 装 pyinstaller + 打包） |
| `go-build` | Go语言构建 | `devcloud2018.codeci_action_20026.action` | image=go-1.10.3, command（go build ./...，GOPROXY 华为云） |
| `php-build` | PHP构建 | `devcloud2018.codeci_action_20037.action` | image=php7.3.3, command（composer install，华为云镜像） |
| `cmake-build` | CMake构建 | `devcloud2018.codeci_action_20005.action` | image=cmake3.10.1-gcc5.5.0, command（mkdir build && cmake && make） |
| `shell-command` | 执行shell命令 | `devcloud2018.codeci_action_20017.action` | image=shell4.2.46-git1.8.3-zip6.00, command=`echo 'hello'`（**必须覆盖**为实际命令） |
| `upload-release` | 上传软件包到软件发布库 | `devcloud2018.codeci_action_20018.action` | file=`**/target/*.?ar`（按项目改，npm 常配 `**/dist/*`）, remainOriginPath=FLAT |
| `upload-release-win` | 上传软件包(Windows环境) | `devcloud2018.codeci_action_20022.action` | file=archive.zip |
| `build-image-swr` | 制作镜像并推送到SWR | `devcloud2018.codeci_action_20004.action` | image=docker18.03, imageName/tag/organization（必填，按项目改）, registryUrl=swr.cn-north-4.myhuaweicloud.com |
| `upload-obs` | 上传文件到OBS | `devcloud2018.codeci_action_20057.action` | backetName（必填，OBS 桶名）, artifactSourcePath=bin/* |
| `download-obs` | 从OBS下载文件 | `devcloud2018.codeci_action_20063.action` | bucketName/objectKey（必填） |
| `unit-report` | 单元测试报告 | `devcloud2018.codeci_action_20071.action` | unit_type/file/junitCoverageSwitch |

> 说明：
> - `language` 组合表见 language-combinations.md（`maven-build` 等 template_id 与 module_id 可互换使用）。
> - `upload-release` 的 `file` 是产物通配，**按项目修改**（Maven 配 `**/target/*.?ar`，npm 常配 `**/dist/*`，action 默认 `bin/*`）。
> - `build-image-swr` 的 `imageName`/`tag`/`dockerFilePath`/`organization` 为必填，按项目改。
> - module_id 白名单约束见 language-combinations.md「module_id 白名单」。

## 官方模板查询职责

- **`list_templates` 仅查用户自定义模板**（`ListCustomTemplate`，`/v1/template/custom`），用于创建任务前检查"是否有用户已自建的、可直接使用的模板"。
- **官方模板不通过工具查询**——create_job 组装直接用 bundle 内打包的 step-templates.json（`language` 组合或 `stepsPlan`）。
- 创建任务流程：**先 `list_templates` 查自定义模板**（有匹配 → 参考/直接用其 steps；无匹配 → 用本地 `language` 组合或 `stepsPlan`）。空结果不应视为"无可用模板"，应回退本地语言组。
