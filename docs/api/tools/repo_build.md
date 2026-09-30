# 工具契约 — codeartsbuild_repo_build

> **来源**: `docs/api/api-contract.md` §2.16（工具接口契约，唯一事实来源）

### 2.16 codeartsbuild_repo_build

**本地构建**（本地构建域，唯一工具）：执行代码仓编译构建，内部完成类型探测、编译指导、命令执行、产物收集、过程留档；实际编译过程由模型自行判断。

| 项 | 值 |
|----|----|
| **名称** | `codeartsbuild_repo_build` |
| **场景** | B. 代码仓构建 |
| **实现** | `src/providers/local-build/build.ts`——内部步骤：① `fs` 探测仓库类型/语言/构建工具（可选探测，仓库类型未传时自动）；② 按仓库类型给出**编译指导**（参考命令 + 注意点）；③ `child_process.spawn` 执行编译（命令由模型传入或参考指导），收集 stdout/stderr 尾部（各 4KB），退出码判定成功/失败；④ 失败时正则匹配 stderr 分类异常（见 FE-01-本地代码仓构建流程设计-20260919.md §5.1）；⑤ 成功后按工具默认 patterns 用 `glob` 扫描产物（`target/*.jar`/`dist/*`/`build/*`）；⑥ 自动留档到 `.codeartsbuild/build-records/`。不经 KooCLI。 |

**输入参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| repoPath | string | ✅ | — | 本地仓库地址 |
| repoType | string | ❌ | 自动探测 | 仓库类型（如 `maven`/`gradle`/`npm`/`go`/`python`/`docker`），缺省时工具自动探测 |
| buildCommandHint | string | ❌ | — | 参考编译命令（模型已判明时传入；缺省由工具按仓库类型给出编译指导） |
| timeoutMs | number | ❌ | 1800000 | 超时（默认 30 分钟） |

**输出示例**：

```json
{
  "status": "SUCCESS",
  "repo_path": "D:/code/ai/demo",
  "repo_type": "maven",
  "build_command": "mvn package -DskipTests",
  "build_guidance": "Maven 项目：参考命令 `mvn package -DskipTests`；产物默认输出于 target/ 目录",
  "exit_code": 0,
  "stdout_tail": "[INFO] BUILD SUCCESS...",
  "stderr_tail": "",
  "duration_seconds": 120,
  "artifacts": [
    {
      "name": "demo-1.0.0.jar",
      "type": "local",
      "language": "Java",
      "record_id": "2026-09-16_100000",
      "size_bytes": 245760,
      "uri": "target/demo-1.0.0.jar"
    }
  ],
  "recommended_steps": [
    { "module_id": "devcloud2018.codeci_action_20043.action", "name": "Maven 构建", "command": "mvn package -DskipTests" },
    { "module_id": "devcloud2018.codeci_action_20018.action", "name": "上传软件包到软件发布库" }
  ],
  "archived": {
    "record_id": "2026-09-16_100000",
    "path": ".codeartsbuild/build-records/2026-09-16_100000.json"
  }
}
```

> 产物结构体：`type: local`（本地介质，统一结构体见 operations/artifacts.md §1）；`language` 语言类型、`record_id` 留档 ID、`uri` 为仓库内相对路径。

**recommendedSteps → create_job.steps 映射契约（待办 #5 补齐）**：

| 项 | 规约 |
|----|------|
| **同构约束** | `recommended_steps[].{module_id, name}` 必填，与 `create_job.steps` 入参**完全同构**（§2.4）；`command` 可选，从 `build_command` 推导 |
| **repo_type → module_id 默认映射** | **module_id 为全限定名**（`devcloud2018.codeci_action_XXXXX.action`）；映射以 `ListOfficialTemplate` + `ListModulesDetail` 实测为准（**2026-09-18 已拆解，见 `docs/design/FE-04-Step模板库拆解-20260918.md` §5**：maven→`20043`、gradle→`20008`、npm→`20014`、yarn→`20019`、go→`20026`、python→`20016`、php→`20037`、cmake→`20005`、msbuild→`20020`、docker→`20004`），**禁止臆造短名** |
| **步骤追加** | 除构建步骤外，模型可按需追加"上传软件包/上传镜像"等后续步骤（module_id 取自 `list_templates` 官方模板；OBS 上传待实测确认） |
| **直接可用** | 本地构建成功后，`recommended_steps` 可直接作为 `create_job` 的 `steps` 入参（附 `arch`/`jobName`/`projectId`） |
| **约束** | 模型不得臆造 `module_id`——必须取自本字段、`list_templates` 返回或已实测白名单（FE-03-工具详细设计-20260918.md §3.3） |

**失败时**：

```json
{
  "status": "FAILED",
  "repo_path": "D:/code/ai/demo",
  "repo_type": "maven",
  "build_command": "mvn package -DskipTests",
  "exit_code": 1,
  "error": {
    "error_type": "DEPENDENCY_MISSING",
    "error_code": null,
    "message": "Could not resolve dependencies...",
    "context": "mvn package 前 2 行"
  },
  "stdout_tail": "...",
  "stderr_tail": "Could not resolve...",
  "archived": { "record_id": "2026-09-16_100100", "path": ".codeartsbuild/build-records/2026-09-16_100100.json" }
}
```

**模型自决规约**（见 FE-01-本地代码仓构建流程设计-20260919.md §4）：
- 编译命令：模型基于仓库类型/编译指导自行判断传入 `buildCommandHint`；未传入时工具按仓库类型给出参考指导
- 异常修复：`status=FAILED` 返回结构化错误 → 模型自行判断修复策略（用通用 bash 能力装依赖/修正命令后重调本工具）；修复无果 → 通知用户交互
- 探测与留档：工具内部完成，模型无需单独关心
