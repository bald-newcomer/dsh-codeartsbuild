# CodeArtsBuild 插件 — Step 模板库（官方模板拆解）

> **文档编号**: CAB-DESIGN-004
> **版本**: v0.7.2（迭代由用户决定）
> **日期**: 2026-09-18
> **状态**: 待评审
> **上游依赖**: 接口契约（`docs/api/api-contract.md` §2.4/§2.13）、工具详细设计（`docs/design/tool-details.md` §3.3/§3.4）
> **数据来源**: `ListOfficialTemplate`（33 个官方模板）+ action 参数定义（`codeci_action_XXXXX`）+ `CodeArtsPipeline ListModulesDetail` 实时接口（36 个插件）；原始数据存 `docs/example/official-templates.json` / `modules-detail.json`；step 索引产出 `docs/example/step-index.json`

## 0. 文档定位

create_job 模板化组装（tool-details.md §3.4）的 **step 模板资产**：各语言核心构建 step 的默认 properties（§2/§3）+ 权威插件清单（§4，image 可选值/官方名称/execution 流水线）。

**使用规约**：
- module_id 必须取自本文档、`repo_build.recommended_steps` 或 `list_templates`（三者一致），**禁止臆造**。
- 字段定义（image 可选值、必填项、枚举）以 **action 参数 schema 与 `ListModulesDetail` 实时接口**为准（§4）；默认 properties 取自官方模板实测，模型可按需覆盖。

---

## 1. 语言 → 推荐步骤组合（create_job 组装参考）

> **不维护插件（2026-09-18 用户确认，不在模板和 create_job 中使用）**：Ant `20002`、Bazel `20055`、Yarn `20019`（直接用 npm `20014` 替代）、Grunt `20010`、gulp `20011`、Android 快应用 `20036`、SetupTool `20016`、Gnu-arm `20007`、Msbuild `20020`、Sbt `20046`、Grails `20009`、mono `20013`、HarmonyOS `20075`、Android APK 签名 `20033`、Kotlin `20072`、Flutter `20062`。如需构建对应场景，走**自定义构建环境**（`20017` 执行 shell 命令 + 自定义 image）或**自定义执行机 linux 模式**。`step-index.json` 已过滤这些插件。

| 语言/场景 | 推荐 steps 组合 | 说明 |
|-----------|----------------|------|
| Java/Maven（jar） | `20043` Maven构建 + `20018` 上传软件包 | 标准 jar 交付 |
| Java/Maven（容器） | `20043` Maven构建 + `20004` 制作镜像推 SWR | 容器化交付 |
| Java/Gradle | `20008` Gradle构建 + `20018` 上传软件包 | — |
| Java/Android | `20032` Android构建 + `20018` 上传软件包 | APK 交付 |
| JavaScript/npm | `20014` npm构建 + `20018` 上传软件包 | 前端/Node 交付；Yarn 场景亦用 npm |
| JavaScript/npm（容器） | `20014` npm构建 + `20004` 制作镜像推 SWR | — |
| Python/PyInstaller | `20015` PyInstaller + `20018` 上传软件包 | 可执行文件交付 |
| Python/其他（setuptools 等） | `20017` 执行shell命令（自定义 image/command） + `20018` 上传软件包 | SetupTool 不维护 |
| Go | `20026` Go语言构建 + `20018` 上传软件包 | 二进制交付 |
| PHP | `20037` PHP构建 + `20018` 上传软件包 | — |
| C/C++/CMake | `20005` CMake构建 + `20018` 上传软件包 | — |
| C#/MSBuild | `20017` 执行shell命令（自定义 image，msbuild/dotnet 命令） + `20022` 上传软件包 | Msbuild/mono 不维护 |
| Scala/sbt | `20017` 执行shell命令（自定义 image，sbt 命令） + `20018` 上传软件包 | Sbt 不维护 |
| 通用/自定义 | `20017` 执行shell命令（自定义 command） | 任意脚本；覆盖 Ant/Bazel/Grunt/gulp/Grails/Gnu-arm/Kotlin/Flutter 等不维护构建 |
| 纯镜像 | `20004` 制作镜像推 SWR（imageName/tag 自定义） | — |
| 产物传 OBS | `20057` 上传 OBS 对象（artifactSourcePath/backetName） | 产物 → OBS 桶交付 |
| 从 OBS 拉取 | `20063` 下载 OBS 对象（bucketName/objectKey） | 依赖/产物下载 |

**官方模板变体**（同语言标准组合的衍生，按需参考；含不维护工具的变体改用 shell 自定义实现）：Maven-容器/DevStar-Maven-容器构建（Maven+镜像）、发布maven私有包（20043 变体）、ServiceStage-Maven-镜像构建（Maven+镜像+Shell+上传）、servicestage-npm-war（npm+Shell+上传×2）、serverless-npm（npm+上传×2）、DevStar-Python-容器构建（Python+镜像）、MSBuild for Qt（改 shell）、HarmonyOS/QuickApp/Grunt/gulp/mono（均改 shell 自定义）。

---

## 2. 核心构建 Step 模板（默认 properties）

> JSON 为官方模板实测默认值（create_job 组装直接可用）；image 可选值/必填项见 §4 权威清单。

### 2.1 Maven 构建 `devcloud2018.codeci_action_20043.action`

```json
{
  "image": "maven3.5.3-jdk8-open",
  "command": "mvn package -Dmaven.test.skip=true -U -e -X -B",
  "cacheOption": "cached",
  "settingMode": "auto",
  "doCheck": "disable",
  "dependencyProjectDir": "./",
  "dependencySettings": "~/.m2/settings.xml",
  "pomMode": "no",
  "releaseArtifact": { "displayName": "", "value": "" },
  "snapshotArtifact": { "displayName": "", "value": "" },
  "deal": "notDeal",
  "ignoreTest": false,
  "file": "**/TEST*.xml",
  "junitCoverageSwitch": false,
  "coverageReportPath": "**/site/jacoco",
  "junitRegionSwitch": true,
  "preCondition": "SUCCESS"
}
```

### 2.2 Gradle 构建 `devcloud2018.codeci_action_20008.action`

```json
{
  "gradle": { "displayName": "Gradle_Wrapper", "value": "4.8" },
  "jdk": { "displayName": "1.8", "value": "1.8" },
  "command1": "cp /cache/android/wrapper/gradle-wrapper.jar ./gradle/wrapper/gradle-wrapper.jar\n/bin/bash ./gradlew build --init-script ./.codeci/.gradle/init_template.gradle -Dorg.gradle.daemon=false",
  "command2": "gradle build",
  "preCondition": "SUCCESS"
}
```

### 2.3 Android 构建 `devcloud2018.codeci_action_20032.action`

```json
{
  "gradle": { "displayName": "Gradle_Wrapper（推荐）", "value": "4.8" },
  "jdk": { "displayName": "1.8", "value": "1.8" },
  "ndk": { "displayName": "不使用", "value": "undefind" },
  "command1": "cp /cache/android/wrapper/gradle-wrapper.jar ./gradle/wrapper/gradle-wrapper.jar\n/bin/bash ./gradlew assembleDebug -Dorg.gradle.daemon=false",
  "command2": "gradle assembleDebug --stacktrace",
  "preCondition": "SUCCESS"
}
```

### 2.4 npm 构建 `devcloud2018.codeci_action_20014.action`

```json
{
  "image": "nodejs12.7.0",
  "command": "export PATH=$PATH:/root/.npm-global/bin\nnpm config set cache /cache/npm --global\nnpm install --registry https://repo.huaweicloud.com/repository/npm/\nnpm run build",
  "preCondition": "SUCCESS"
}
```

### 2.5 PyInstaller 构建（Python） `devcloud2018.codeci_action_20015.action`

```json
{
  "image": "python3.6",
  "command": "pip config set global.index-url https://repo.huaweicloud.com/repository/pypi/simple\npip install pyinstaller\npyinstaller -F main.py",
  "preCondition": "SUCCESS"
}
```

### 2.6 Go 语言构建 `devcloud2018.codeci_action_20026.action`

```json
{
  "image": "go-1.10.3",
  "command": "export GO15VENDOREXPERIMENT=1\nexport GOPROXY=https://goproxy.io\ngo build ./...",
  "preCondition": "SUCCESS"
}
```

### 2.7 PHP 构建 `devcloud2018.codeci_action_20037.action`

```json
{
  "image": "php7.3.3",
  "command": "composer config -g secure-http false\ncomposer config -g repo.packagist composer https://packagist.huaweicloud.com\ncomposer install",
  "preCondition": "SUCCESS"
}
```

### 2.8 执行 Shell 命令 `devcloud2018.codeci_action_20017.action`

```json
{
  "image": "shell4.2.46-git1.8.3-zip6.00",
  "command": "echo 'hello'",
  "preCondition": "SUCCESS"
}
```

### 2.9 其他语言构建（同构：image + command + preCondition）

| module_id | name | 默认 image | 默认 command 摘要 |
|-----------|------|-----------|------------------|
| `20005` | CMake构建 | cmake3.10.1-gcc5.5.0 | `mkdir build && cd build && cmake .. && make` |

> 其余语言构建插件（Ant/Bazel/Grunt/gulp/快应用/SetupTool/Gnu-arm/Msbuild/Sbt/Grails/mono/HarmonyOS/Kotlin/Flutter）**不维护**（权威清单见 §1），不在模板/create_job 使用；对应场景走自定义构建环境（`20017` shell + 自定义 image）或自定义执行机 linux 模式。

---

## 3. 通用附加 Step 模板

### 3.1 上传软件包到软件发布库 `devcloud2018.codeci_action_20018.action`

```json
{
  "file": "**/target/*.?ar",
  "buildVersion": "",
  "name": "",
  "customUploadPath": "",
  "remainOriginPath": "FLAT",
  "uploadTool": "curl",
  "preCondition": "SUCCESS"
}
```

> 跨语言标准尾步（Maven/npm/Go/Python 均配套）。`file` 产物通配按项目改（action 默认 `bin/*`，Maven 配 `**/target/*.?ar`，npm 常配 `**/dist/*`）。

### 3.2 制作镜像并推送到 SWR 仓库 `devcloud2018.codeci_action_20004.action`

```json
{
  "image": "docker18.03",
  "imageName": "demo",
  "tag": "v1.1",
  "contextPath": ".",
  "dockerFilePath": "./Dockerfile",
  "organization": "",
  "cache": "true",
  "setMetaData": "no",
  "registryUrl": { "displayName": "华为云镜像仓库SWR", "value": "swr.cn-north-4.myhuaweicloud.com" },
  "authUser": { "displayName": "当前用户", "value": "current" },
  "iamEndPoint": { "displayName": "", "value": "" },
  "preCondition": "SUCCESS"
}
```

> 容器类模板尾步。`imageName`/`tag`/`dockerFilePath`/`organization`（必填）按项目改；`registryUrl=other` 时 `selectRegion`/`endpointUuid` 条件必填。

### 3.3 上传软件包（archive.zip 变体） `devcloud2018.codeci_action_20022.action`

```json
{
  "file": "archive.zip",
  "buildVersion": "",
  "name": "",
  "groupId": "",
  "preCondition": "SUCCESS"
}
```

> MSBuild 系专用上传。

### 3.4 上传 OBS 对象 `devcloud2018.codeci_action_20057.action`

```json
{
  "authorizationUser": { "displayName": "当前用户", "value": "current" },
  "iamEndPoint": { "displayName": "", "value": "" },
  "artifactSourcePath": "bin/*",
  "backetName": "",
  "obsEndPoint": "",
  "objectKey": "./",
  "artifactDestName": "",
  "uploadDirectory": true,
  "rootDirectory": "",
  "obsHeaders": [],
  "preCondition": "SUCCESS"
}
```

> `backetName`（必填，OBS 桶名）；用于构建产物上传 OBS 交付。

### 3.5 下载 OBS 对象 `devcloud2018.codeci_action_20063.action`

```json
{
  "authorizationUser": { "displayName": "当前用户", "value": "current" },
  "iamEndPoint": { "displayName": "", "value": "" },
  "obsEndPoint": "",
  "bucketName": "",
  "objectKey": "",
  "downloadPath": "",
  "preCondition": "SUCCESS"
}
```

> `bucketName`/`objectKey`（必填）；用于从 OBS 拉取产物/依赖。

---

## 4. 权威插件清单（ListModulesDetail 实时接口，36 个）

> `CodeArtsPipeline ListModulesDetail --locations.1=devcloud.codeci.action.list` 2026-09-18 实测。**image 可选值、必填项、官方名称、execution 内部流水线以本表为准**。
>
> **module_id 拼接**：uuid `20043` → `devcloud2018.codeci_action_20043.action`（publisher `devcloud2018` + `codeci_action_` + uuid + `.action`）。

### 4.1 核心构建插件

| uuid | 官方名称 | execution 内部流水线 | image 可选值（默认加粗） |
|------|----------|---------------------|------------------------|
| 20043 | Maven构建 | preMaven → maven构建 → postMaven | **maven3.5.3-jdk8-open**/jdk7/jdk10/jdk11/jdk17×2/jdk21/jdk25 等 10 个 |
| 20008* | Gradle | gradle环境初始化 → gradle构建 | gradle/jdk 选择 |
| 20032 | Android构建 | Gradle环境初始化 → gradle构建 | gradle/jdk/ndk 选择 |
| 20014 | Npm构建 | npm构建 | **nodejs12.7.0**/8.11.2/10.1.0/10.15.3/13~24 共 13 个 |
| 20015 | PyInstaller构建 | PyInstall构建 | **python3.6**/2.7/3.5/3.7~3.12 共 9 个 |
| 20026* | Go语言构建 | go语言构建 | **go-1.10.3**/1.11.6~1.26 共 15 个 |
| 20037 | PHP构建 | php构建 | **php7.3.3**/5.6.40/7.4.33/8.0.30/8.2/8.4 |
| 20005 | CMake构建 | CMake构建 | **cmake3.10.1-gcc5.5.0**/2.8.12~3.26.5 共 12 个 |

> \* 20008/20026 在实时接口中无 uuid 字段，取自模板/action 映射。
>
> **不维护插件（用户 2026-09-18 确认，权威清单见 §1）**：不在模板和 create_job 中使用；对应场景走自定义构建环境（`20017` shell + 自定义 image）或自定义执行机 linux 模式。

### 4.2 通用/附加插件

| uuid | 官方名称 | execution | 关键参数 |
|------|----------|-----------|----------|
| 20018 | 上传软件包到软件发布库 | 上传软件包 | file/buildVersion/name/customUploadPath/remainOriginPath/uploadTool |
| 20022 | 上传软件包(Windows环境) | 上传软件包 | file/buildVersion/name/groupId |
| 20004 | 制作镜像并推送到SWR仓库 | 制作镜像并推送 | image/registryUrl/organization/imageName/tag 等 15 个 |
| 20028 | 使用SWR公共镜像 | 使用SWR公共镜像构建 | image/command |
| 20017 | 执行shell命令 | shell构建 | image/command |
| 20035 | 执行Docker命令 | 执行Docker命令 | image/dockerCommand |
| 20057 | 上传文件到OBS | 上传文件到OBS | authorizationUser/backetName/artifactSourcePath 等 11 个 |
| 20063 | 从OBS下载文件 | 从OBS下载文件 | authorizationUser/bucketName/objectKey 等 7 个 |
| 20061 | 下载文件管理的文件 | 下载文件 | image/filename |
| 20045* | 下载发布仓库包 | 下载发布仓库包 | image/fileUrl |
| 20071 | 单元测试报告 | 处理单元测试报告 | image/unit_type/file/junitCoverageSwitch/coverageFormat |

> 模板未覆盖但实时接口确认的插件：`20071` 单元测试报告、`20035` 执行Docker命令、`20061` 下载文件管理、`20045` 下载发布仓库包、`20022` 上传(Windows)。其余实时接口插件（Flutter `20062`/Kotlin `20072`/APK 签名 `20033` 等）**不维护**，不在模板/create_job 使用。

> **execution 说明**：`execution.steps[].displayName` 为插件内部执行阶段（环境初始化/构建/报告处理），**非 create_job.steps 入参**（create_job 只需 module_id + properties）。

---

## 5. 关键关系

- **OBS 步骤**：`20057` 上传 / `20063` 下载——实时接口确认存在（契约 §8 #2 OBS 闭环）：OBS 作为**构建 step** 交付产物，但 ShowNewOutput 响应无 obs 字段，产物查看需 console_url（见 operations/artifacts.md）。
- **repo_type → module_id 映射**：maven→`20043`、gradle→`20008`、npm→`20014`、yarn→`20019`、go→`20026`、python→`20016`、php→`20037`、cmake→`20005`、msbuild→`20020`、docker→`20004`（契约 §2.16 引用）。⚠️ 其中 yarn `20019`/python(setuptools) `20016`/msbuild `20020` 属**不维护插件**——映射仅用于识别语言，创建任务时改用 shell 自定义或对应支持工具。

---

## 6. 来源与刷新

- **来源**：`ListOfficialTemplate`（33 模板，模板 properties）+ action 参数 schema + `CodeArtsPipeline ListModulesDetail`（36 插件，权威字段/execution/image 可选值），2026-09-18 实测。其中 16 个**不维护插件**（§1 清单）已过滤，不进入 step 索引/模板/create_job。
- **原始数据**：`docs/example/official-templates.json`（120KB）、`modules-detail.json`（283KB 原始 + `modules-detail-fixed.json` 修复转义）、`step-index.json`（20 条索引产出）——均不入库（docs/example 在 .gitignore）。
- **刷新**：模板/插件随服务更新；插件实现时重拉并更新 §4 默认值。用户自建模板走 `ListCustomTemplate`（本文档不覆盖）。

---

## 7. 模板引擎设计方案（待办 #13/#14 ✅ 已完成，#15/#16 待办）

> 目标：基于 step 索引 + 模板引擎组装完整任务配置，后续创建任务不再手工拼 steps。step 索引（#13 ✅）、step 模板 + config 模板（#14 ✅）已落地；验证测试套（#15）与更新机制（#16）待执行。

### 7.1 step 索引（待办 #13：✅ 已完成）

**数据源**：`docs/example/modules-detail-fixed.json`（36 插件，ListModulesDetail 实测）。
**产出**：`docs/example/step-index.json`（**20 条**——已过滤 16 个不维护插件，按 uuid 排序）；抽取脚本 `docs/example/extract-step-index.py`（可重跑刷新，`UNSUPPORTED` 集合过滤）。

**step 索引条目结构**（每个 module_id 一条，与 `step-index.json` 一致）：

```json
{
  "module_id": "devcloud2018.codeci_action_20043.action",   // 主键（顶层，权威）
  "uuid": "20043",                                          // module_id 派生（创建任务实际使用值）
  "name": "Maven构建",                                       // 步骤中文名（properties.name；空值兜底）
  "description": "使用Apache Maven构建Java项目。...",        // 顶层描述（含操作指南链接）
  "tags": ["build", "java", "maven", "linux", "x86-64", "arm"],  // 语义标签 + os + arch
  "execution": ["preMaven", "maven构建", "postMaven"],       // properties.execution 流水线
  "parameters": [                                           // 核心参数 schema（精简）
    { "name": "image", "label": "工具版本", "required": true,
      "default": "maven3.5.3-jdk8-open", "select": ["maven3.5.3-jdk8-open", "..."] }
  ],
  "default_properties": { "image": "maven3.5.3-jdk8-open", "command": "mvn package -DskipTests",
                          "preCondition": "SUCCESS" }        // 官方模板/实测回填（§2/§3）
}
```

**字段来源与规则**：

| 字段 | 来源 | 规则 |
|------|------|------|
| `module_id` | 顶层 | **主键**，权威；create_job.steps 直接使用 |
| `uuid` | module_id 派生 | 与 `properties.uuid` 可能不一致（GFortran 20060 vs 20037）——以 module_id 派生值为准 |
| `name` | `properties.name` | 空时兜底（Yarn 20019 → "Yarn构建"，§4 权威清单） |
| `tags` | `properties.tags` + 语义映射 | 语义标签（build/file/docker/test + 语言/工具）+ os（linux/windows）+ arch（x86-64/arm）；`SEMANTIC_TAGS` 表在抽取脚本内 |
| `execution` | `properties.execution.steps[].displayName` | 内部流水线（preMaven→maven构建→postMaven 等） |
| `parameters` | `properties.parameters[]` | 精简 schema：name/label/required/default/select；`preCondition` 默认 `SUCCESS` |
| `default_properties` | 官方模板 + job_config.json 实测 | §2/§3 默认值回填，`preCondition: "SUCCESS"`（config 实测值） |

> **过滤说明**：`modules-detail-fixed.json` 原始 36 插件，其中 16 个**不维护插件**（§1 清单）由 `extract-step-index.py` 的 `UNSUPPORTED` 集合过滤，不产出索引条目，也不进入模板/create_job。

### 7.2 step 模板（待办 #14 前半）

基于**常用步骤**（tags 含 `build` + §1 推荐组合；常用度由 §1 语言→步骤组合表决定，无 L0/L1/L2 分级——`step-index.json` 的 tags 只含语义+os+arch）生成 step 模板 = 索引条目 + 默认 properties 组合。

**✅ 已落地**：`docs/example/step-templates.json`（14 个模板，生成脚本 `docs/example/generate-templates.py`）。结构：

```json
{
  "template_id": "maven-build",
  "name": "Maven构建",
  "module_id": "devcloud2018.codeci_action_20043.action",
  "properties": { "image": "maven3.5.3-jdk8-open", "command": "mvn package -DskipTests", "cacheOption": "cached", "preCondition": "SUCCESS" }
}
```

> **properties 组装规则**：① 取 `step-index.json` 的 `default_properties`（官方模板/实测回填）；② 补必填参数——`default_properties` 未覆盖的必填参数取 `parameters[].default`，无默认值则空串占位（如 OBS 上传的 `authorizationUser`/`backetName`、shell 的 `command`）。`preCondition` 统一 `"SUCCESS"`。

常用 step 模板清单（已生成 14 个，从 `step-index.json` 选取——索引已过滤不维护插件）：Maven 构建/上传软件包/制作镜像推 SWR/执行 shell 命令/npm 构建/Go 构建/PyInstaller 构建/PHP 构建/CMake 构建/Gradle 构建/Android 构建/OBS 上传/OBS 下载/单元测试报告（覆盖 §1 推荐组合）。不维护插件（§1 清单）不生成 step 模板，对应场景走 shell 自定义。

### 7.3 完整 config 模板（待办 #14：✅ 已完成）

**数据源**：`docs/example/job_config.json`（ShowJobConfig 实测响应，仅取骨架参考）+ `CreateNewJob` 契约（api-contract §2.4，请求体 camelCase 权威）。
**✅ 已落地**：`docs/example/config-template.json`（生成脚本 `docs/example/generate-templates.py`）。config 模板 = CreateNewJob 请求体骨架 + steps/scms/parameters 占位：

```json
{
  "arch": "x86-64",
  "projectId": "{{projectId}}",
  "jobName": "{{jobName}}",
  "description": "{{description}}",
  "steps": "{{steps}}",            // 由 step 模板引擎组装（§7.4 ②）
  "scms": "{{scms}}",              // 代码源（可选）
  "parameters": "{{parameters}}",  // 任务参数（可选，双层结构）
  "flavor": "DEFAULT",
  "hostType": "devcloud",
  "buildConfigType": "ACTION",
  "sourceCode": "codeci",
  "buildIfCodeUpdated": false,
  "autoUpdateSubModule": "false",
  "agencyUrn": "{{agencyUrn}}",    // 委托（可选）
  "groupId": "{{groupId}}"         // 任务分组（可选）
}
```

> **命名规约**：config 模板（请求体）用 **camelCase**（`projectId`/`jobName`/`hostType`/`buildConfigType`），对齐 `CreateNewJob` 入参（契约 §2.4）；`job_config.json`（ShowJobConfig 响应）的 snake_case（`project_id`/`job_name`）**仅作骨架参考，不直接用于请求体**。steps 项内仍为 `module_id`（全限定名）+ `name` + `properties`。

> 字段对齐 `CreateNewJob` 请求体（契约 §2.4）；`code_checkout_config`/`limit_time`/`actions` 等读侧字段不参与创建入参。

### 7.4 模板引擎组装流程（创建任务）

> **形态**：组装为**工程实现**（bundle 内 `src/providers/codeartsbuild/template-assembler.ts`），非 LLM 手工拼全限定名；模型经 `create_job` 传 **`stepsPlan`（意图级步骤计划：`[{ step, properties? }]`，数组顺序即步骤顺序 + 每步参数覆盖，推荐）** 或 `language`（速选默认组合）表达意图，组装器产出合法 steps（tool-details.md §3.4）。**语言 → 组合映射**（组装器内置，`language` 速选用，对齐 §1）：

| language（§1 组合） | 组装 steps（template_id 或 module_id） |
|---------------------|----------------------------------------|
| Java/Maven（jar） | maven-build + upload-release |
| Java/Maven（容器） | maven-build + build-image-swr |
| Java/Gradle | gradle-build + upload-release |
| Java/Android | android-build + upload-release |
| JavaScript/npm | npm-build + upload-release |
| JavaScript/npm（容器） | npm-build + build-image-swr |
| Python/PyInstaller | pyinstaller-build + upload-release |
| Python/其他（setuptools 等） | shell-command（自定义 command）+ upload-release |
| Go | go-build + upload-release |
| PHP | php-build + upload-release |
| C/C++/CMake | cmake-build + upload-release |
| C#/MSBuild | shell-command（msbuild/dotnet 命令）+ `20022` 上传(Windows) |
| Scala/sbt | shell-command（sbt 命令）+ upload-release |
| 通用/自定义 | shell-command |
| 纯镜像 | build-image-swr |
| 产物传 OBS | upload-obs |
| 从 OBS 拉取 | download-obs |

**组装流程**：

```
① 用户意图 → stepsPlan（步骤顺序 + 每步参数，推荐）或 language（速选默认组合）
② create_job 组装器：stepsPlan 逐项 resolveStep（template_id/module_id → 模板）｜language 展开 §1 组合
③ assembleSteps：载入 step-templates.json → 每步合并 properties（默认 + 覆盖）→ steps[]（顺序=数组顺序）
④ assembleConfig：载入 config-template.json → 注入 projectId/jobName/steps/scms/parameters
⑤ validateSteps（module_id 白名单）→ 产出完整 CreateNewJob 请求体 → 调用
```

**stepsPlan 示例**（Maven 构建 → 单元测试报告 → 上传软件包，自定义顺序与参数）：

```json
[
  { "step": "maven-build", "properties": { "command": "mvn clean package -DskipTests" } },
  { "step": "unit-report", "properties": { "file": "target/surefire-reports/TEST-*.xml" } },
  { "step": "upload-release", "properties": { "file": "target/*.jar", "buildVersion": "1.0.0" } }
]
```

### 7.5 验证与更新（待办 #15 方案已设计 / #16 待办）

> **待办 #15 方案已设计**：见 `docs/design/template-validation-suite.md` v0.1.0（17 组合 + 7 边界 = 24 用例、分层执行、断言 16 条、失败 3 轮修正闭环、与 #16 联动）。实现待 src 编码。

| 待办 | 策略 |
|------|------|
| #15 验证测试套 | 调用实际接口（`CreateNewJob`）创建**各种场景**的自动化任务：按 §1 组合逐个创建（Maven jar/容器、npm、Go、Python、OBS 等），断言创建成功 + `ShowJobConfig` 回读一致 → 验证 step/config 模板有效性；失败场景记录修正模板 |
| #16 模板更新 | **step 模板**：重调 `ListModulesDetail` 重新获取 modules-detail → 评估新增/变更 module_id/name/tags/parameters → 更新索引与 step 模板；**config 模板**：调 `ShowJobConfig` 获取任意构建任务 config → 比对字段增减 → 更新 config 模板骨架 |
