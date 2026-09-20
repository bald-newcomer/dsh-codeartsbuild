/**
 * create_job 工具 schema 定义（schemastery）
 * 对齐 api-contract.md §2.4 create_job 入参
 */
import schema from '@deepseek-ai/schemastery';

const z = schema;

/** create_job 输入 schema */
export const createJobSchema = z.object({
  projectId: z.string().description('项目 ID（UUID，32 位数字字母）。缺省时取会话上下文（架构 §4.3 优先级：显式 > 会话 > 配置 > 询问）；显式传入覆盖并更新上下文').required(false),
  jobName: z.string().description('任务名称（中英文/数字/下划线/连接符，长度 1~115）').required(true),
  arch: z.union([z.const('x86-64'), z.const('arm')]).description('机器架构（枚举 x86-64 / arm）').required(true),
  stepsPlan: z.array(
    z.object({
      step: z.string().description('template_id（推荐，如 "maven-build"）或 module_id（全限定名，高级）'),
      properties: z.any().description('覆盖该步默认 properties（如 command/image/file）').required(false),
    }),
  ).description('意图级步骤计划（推荐）：[{step, properties?}]，数组顺序即构建步骤顺序，properties 覆盖默认参数').required(false),
  language: z.string().description('语言/场景标识（速选默认组合）：对齐 step-templates.md §1 组合（如 "Java/Maven（jar）"、"JavaScript/npm"、"Go"）').required(false),
  steps: z.any().description('构建步骤（原样透传，高级用法，最高优先）。每项含 module_id（全限定名）+ name + properties? + enable?').required(false),
  scms: z.any().description('代码源，每项含 scm_type/repo_id/repo_name/branch/url/web_url 等').required(false),
  parameters: z.any().description('自定义参数（双层结构：[{name: "hudson.model.StringParameterDefinition", params: [{name, value}]}]）').required(false),
  description: z.string().description('任务描述').required(false),
  flavor: z.string().description('执行机规格（如 DEFAULT / 2u8g，不传用服务端默认）').required(false),
  hostType: z.string().description('主机类型（custom_host / custom_acc / devcloud，默认 devcloud）').required(false),
  buildConfigType: z.string().description('构建配置类型（YAML / ACTION，默认 ACTION）').required(false),
  sourceCode: z.string().description('代码源类型（pipeline / codeci）').required(false),
  buildIfCodeUpdated: z.boolean().description('提交代码触发构建开关（默认 false）').required(false),
  autoUpdateSubModule: z.string().description('是否自动更新子模块（false/true，默认 false）').required(false),
  agencyUrn: z.string().description('委托 urn').required(false),
  groupId: z.string().description('任务分组 ID').required(false),
});

/** create_job 工具定义 */
export const createJobTool = {
  name: 'codeartsbuild_create_job',
  description: `创建构建任务（支持模板化组装）。
入参三选一（优先级 steps > stepsPlan > language）：
① stepsPlan（推荐，意图级步骤计划）：[{step, properties?}]——step 为 step-templates.json 的 template_id（如 maven-build）或 module_id（全限定名）；数组顺序即构建步骤顺序；properties 覆盖该步默认参数。
② language（速选默认组合）：语言/场景标识（如 Java/Maven（jar）、JavaScript/npm、Go），展开为默认组合。
③ steps（原样透传，高级）：每项含 module_id（全限定名）+ name + properties?。
调用前先 repo_build 完成本地构建验证，或 list_templates 获取可用模板。arch 为必填。`,
  schema: createJobSchema,
};
