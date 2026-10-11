# 语言 → 推荐步骤组合（create_job 组装参考）

> 对应 `create_job` 的 `language` 速选参数：语言/场景标识展开为下表固定组合。
> 也可以作为 `stepsPlan` 的设计参考（用下表的 template_id 作为 `step` 值）。

## 环境锚点原则

选择 step 模板以**构建环境/语言族**为锚点，**不以项目具体构建脚本切换模板**：

- TypeScript / JavaScript / Node / 前端项目一律归 **npm 模板 `20014`**（构建环境等价——TS 经 `package.json` 探测为 npm，其 node 环境与 npm 构建等价），即使项目用 `tsc` 编译也不用改选 Shell；命令差异（如 `npm ci && npm run build && npm test`）用 `properties.command` 覆盖。
- Shell 模板 `20017` 仅作无维护语言/通用的兜底。

**判断规则**：
1. **语言类型 ≠ 构建命令**：同语言不同 scripts 不应改变模板选择，只改 `properties.command`。
2. **前端口径优先**：`repo_build` 返回的 `repo_type` 与 `recommended_steps[].module_id` 是模板选择的**强信号**（已实测对齐）。
3. **npm 覆盖 TS/JS/Node**：不因"用了 tsc"而改用 Shell。
4. **Shell 为兜底**：仅当语言无维护模板（下方"不维护插件"列表）或无语言识别时，才用 `20017` shell 自定义。

## 语言 → 组合表

| 语言/场景 | 推荐 steps 组合 | 说明 |
|-----------|----------------|------|
| Java/Maven（jar） | `20043` Maven构建 + `20018` 上传软件包 | 标准 jar 交付 |
| Java/Maven（容器） | `20043` Maven构建 + `20004` 制作镜像推 SWR | 容器化交付 |
| Java/Gradle | `20008` Gradle构建 + `20018` 上传软件包 | — |
| Java/Android | `20032` Android构建 + `20018` 上传软件包 | APK 交付 |
| JavaScript/npm | `20014` npm构建 + `20018` 上传软件包 | 前端/Node 交付；Yarn 场景亦用 npm；**TS/JS/Node 一律归此（环境锚点，命令用 properties.command 覆盖）** |
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

> **产物交付说明（FE-12 P4，2026-10-11）**：`language` 组合**已含上传步骤**（`20018` 上传软件包 / `20004` 镜像 / `20057` OBS）——用 `language` 速选创建的组合默认交付产物。但用户**手拼 `stepsPlan`/`steps`** 时若漏了上传步骤，构建会成功但 `list_artifacts` 为空（8155dd01 实测：TS 项目只配 npm-build，产物留在 lib/ 不交付）。手拼步骤时记得按交付目标补 `upload-release`（`20018`）或对应上传步骤；`upload-release` 的 `file` 通配按项目改（Maven `**/target/*.?ar`，npm `**/dist/*`）。

## 不维护插件（不用）

以下语言/工具的官方插件**不维护**，不在模板和 create_job 中使用；如需构建对应场景，走**自定义构建环境**（`20017` shell + 自定义 image）或自定义执行机 linux 模式：

Ant `20002`、Bazel `20055`、Yarn `20019`（直接用 npm `20014` 替代）、Grunt `20010`、gulp `20011`、Android 快应用 `20036`、SetupTool `20016`、Gnu-arm `20007`、Msbuild `20020`、Sbt `20046`、Grails `20009`、mono `20013`、HarmonyOS `20075`、Android APK 签名 `20033`、Kotlin `20072`、Flutter `20062`。

## module_id 白名单

`module_id` 必须是**实测白名单格式** `devcloud2018.codeci_action_<id>.action`（如 npm `20014` / shell `20017` / maven `20043`），或 `list_templates` 用户模板返回的全限定名。

**在设计/规划阶段（写 stepsPlan、本地配置文件）就禁止自造 module_id 格式**（如 `com.huaweicloud.codearts.build.plugins.*` 等臆造格式——实测暴露过）。

取值**只来自**三个来源，组装前先自检：
1. `repo_build` 返回的 `recommended_steps[].module_id`
2. `list_templates` 返回的用户自定义模板全限定名
3. 本 bundle 内打包的 step-templates.json 模板 id（`maven-build`/`npm-build`/`upload-release` 等）

create_job 对非白名单 module_id 会校验失败。

## stepsPlan 示例

`stepsPlan` 为意图级步骤计划：`[{ step, properties? }]`，数组顺序即步骤顺序，`properties` 覆盖该步默认参数。

```json
[
  { "step": "maven-build", "properties": { "command": "mvn clean package -DskipTests" } },
  { "step": "unit-report", "properties": { "file": "target/surefire-reports/TEST-*.xml" } },
  { "step": "upload-release", "properties": { "file": "target/*.jar", "buildVersion": "1.0.0" } }
]
```
