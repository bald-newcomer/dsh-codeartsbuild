/**
 * codeartsbuild skill 注册到 ctx.skills（2026-11-04）
 *
 * 背景：SKILL.md 是插件面向 LLM 的编排依据（AGENTS.md 目录约定），但宿主
 * `dsh-base` 的 skill-filesystem provider 只扫描 `.dsh/skills`、`.agents/skills`、
 * `$DSH_HOME/skills` 等目录，**不含插件自带 `skills/codeartsbuild/`**——SKILL.md
 * 不会被模型经 `/skill codeartsbuild` 或 `skill` 工具发现。本模块在插件 apply
 * 时用 `ctx.skills.register()` 主动注册（runtime provider，project 层之上）。
 *
 * 路径解析：npm 包根 = lib/ + skills/（package.json files 已含二者）；运行时
 * `lib/entry/skill.js` 经 `import.meta.url` 解析 `../../skills/codeartsbuild/SKILL.md`
 * → 包根/skills/codeartsbuild/SKILL.md。
 *
 * frontmatter 解析对齐 @deepseek-ai/dsh-skill-filesystem（name/description 必填，
 * whenToUse 可选）——SKILL.md 的 YAML frontmatter 天然匹配，无重复维护。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';

/** SKILL.md 相对本模块（lib/entry/skill.js）的位置：../../skills/codeartsbuild/SKILL.md */
const SKILL_RELATIVE_PATH = '../../skills/codeartsbuild/SKILL.md';

/**
 * frontmatter 解析结果
 * - name：skill 名（必填，dsh-skill-filesystem 对齐）
 * - description：SKILL.md frontmatter 的 description 折叠标量（`> ` 块，缩进行按空格拼接）；
 *   注册描述与 SKILL.md 单一事实来源对齐（2026-11-12 会话 ed0ef1ff：硬编码短描述
 *   未含触发词/先加载指令，模型在 available_skills 目录中看到弱触发描述 → 未主动先加载技能）
 * - body：剥离 frontmatter 后的正文
 */
interface ParsedFrontmatter {
  name: string;
  description?: string;
  body: string;
}

/** 解析 YAML frontmatter（name + description 折叠标量 + 正文，容错 CRLF：仓库 SKILL.md 为 Windows CRLF 行尾） */
function parseFrontmatter(raw: string): ParsedFrontmatter | undefined {
  // frontmatter 块：--- ... ---
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) return undefined;
  const fm = match[1];
  const lines = fm.split('\n');
  let name: string | undefined;
  let description: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nm = /^name:\s*"?([^"#\s]+)"?/.exec(line);
    if (nm) {
      name = nm[1];
      continue;
    }
    // description: 折叠标量（`description: >`）——后续缩进行按空格拼接，非缩进行（下一 key）结束
    if (/^description:\s*>/.test(line)) {
      const folded: string[] = [];
      for (let k = i + 1; k < lines.length; k++) {
        const next = lines[k];
        if (next.trim().length === 0 || !/^\s/.test(next)) break;
        folded.push(next.trim());
      }
      if (folded.length) description = folded.join(' ');
    }
  }
  if (!name) return undefined;
  return { name, description, body: match[2].trim() };
}

/** 注册描述兜底（frontmatter description 缺失/解析失败时使用，保持与 SKILL.md 触发语义一致） */
const FALLBACK_DESCRIPTION =
  'Huawei Cloud CodeArts Build 构建生命周期管理（dsh 插件形态）。用户提到"构建任务/编译构建/build job/跑构建/构建失败/构建产物/创建构建/云端构建/代码能编译吗"等 CodeArtsBuild 相关话题时，先加载本技能再行动。本地仓库编译构建探索（subagent）、云端构建任务创建/编排、触发与停止、状态监控、产物与日志、失败诊断。';

/**
 * 加载并注册 codeartsbuild skill
 * - 文件缺失/解析失败 → 静默跳过（不阻断插件启动，tools 注册不受影响）
 * - 成功 → ctx.skills.register({ name, description, whenToUse, content })
 * - 宿主未挂载 skill 服务（ctx.skills 不存在）→ 静默跳过（兼容无 skill 能力的宿主）
 */
export function registerSkill(ctx: Context): void {
  try {
    // 宿主未挂载 skill 服务 → 跳过（非 dsh-base 宿主可能无 ctx.skills）
    const skills = (ctx as Context & { skills?: { register(s: unknown): () => void } }).skills;
    if (!skills || typeof skills.register !== 'function') return;

    let url: URL;
    try {
      url = new URL(SKILL_RELATIVE_PATH, import.meta.url);
    } catch {
      return; // import.meta.url 不可用（非 ESM 环境）→ 跳过
    }
    const raw = readFileSync(fileURLToPath(url), 'utf8');
    const parsed = parseFrontmatter(raw);
    if (!parsed) {
      ctx.logger?.warn?.('codeartsbuild: SKILL.md frontmatter 缺 name，跳过 skill 注册');
      return;
    }
    skills.register({
      name: parsed.name,
      // 描述取 SKILL.md frontmatter（单一事实来源，含"先加载再行动"指令 + 触发词），缺失时用兜底描述
      description: parsed.description ?? FALLBACK_DESCRIPTION,
      whenToUse:
        '用户提到"构建任务/编译构建/build job/跑构建/构建失败/构建产物/创建构建/云端构建/代码能编译吗"等 CodeArtsBuild 相关话题时。',
      // source/provider 必填（validateDefinition 在 skills.get() 时校验）：
      //   source: 'runtime'（运行时注册，对应 SkillSource 联合类型）
      //   provider: 'codeartsbuild'（运行时 provider 标识，registry 内部 RUNTIME_PROVIDER 默认值会被 register 覆盖，
      //            但 get() 返回的 definition 必须含 provider 字段，故显式给）
      source: 'runtime',
      provider: 'codeartsbuild',
      // 与 dsh-skill-filesystem 一致：content 为剥离 frontmatter 后的正文（模型只见正文）
      content: parsed.body,
    });
    ctx.logger?.info?.('codeartsbuild: skill 已注册到 ctx.skills');
  } catch (e) {
    // 静默：SKILL.md 缺失或读取失败不阻断插件
    ctx.logger?.debug?.('codeartsbuild: skill 注册跳过（%s）', (e as Error).message);
  }
}
