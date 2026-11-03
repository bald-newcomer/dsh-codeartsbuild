/**
 * template-assembler 组装器单测（Layer 1，不需网络）
 * 对齐 TEST-01-模板验证测试套件设计-20260918.md §7.2（24 用例：TV-01~17 组合 + TV-E01~E07 边界）
 */
import { describe, it, expect } from 'vitest';
import {
  assembleSteps,
  assembleConfig,
  resolveStep,
  suggestTemplateRefs,
  validateSteps,
  selectTemplates,
  selectTemplatesWithMatch,
  listAvailableTemplates,
  listAvailableLanguages,
  listWhitelistModuleIds,
} from '../src/providers/codeartsbuild/template-assembler.js';
import { ToolException } from '../src/core/types.js';

/** 断言 module_id 为全限定名格式 */
function expectFullyQualified(moduleId: string): void {
  expect(moduleId).toMatch(/^devcloud2018\.codeci_action_\d+\.action$/);
}

/** 断言 step 基础结构 */
function expectValidStep(step: ReturnType<typeof assembleSteps>[number]): void {
  expectFullyQualified(step.module_id);
  expect(step.name).toBeTruthy();
  expect(step.enable).toBe(true);
  expect((step.properties as Record<string, unknown>).preCondition).toBe('SUCCESS');
}

describe('Layer 1: 组装器单测', () => {
  describe('TV-01 ~ TV-17: 语言→组合组装', () => {
    const cases: Array<{ id: string; language: string; expectedSteps: number; expectedModuleIds: string[] }> = [
      { id: 'TV-01', language: 'Java/Maven（jar）', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20043.action', 'devcloud2018.codeci_action_20018.action'] },
      { id: 'TV-02', language: 'Java/Maven（容器）', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20043.action', 'devcloud2018.codeci_action_20004.action'] },
      { id: 'TV-03', language: 'Java/Gradle', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20008.action', 'devcloud2018.codeci_action_20018.action'] },
      { id: 'TV-04', language: 'Java/Android', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20032.action', 'devcloud2018.codeci_action_20018.action'] },
      { id: 'TV-05', language: 'JavaScript/npm', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20014.action', 'devcloud2018.codeci_action_20018.action'] },
      { id: 'TV-06', language: 'JavaScript/npm（容器）', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20014.action', 'devcloud2018.codeci_action_20004.action'] },
      { id: 'TV-07', language: 'Python/PyInstaller', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20015.action', 'devcloud2018.codeci_action_20018.action'] },
      { id: 'TV-08', language: 'Python/其他（setuptools 等）', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20017.action', 'devcloud2018.codeci_action_20018.action'] },
      { id: 'TV-09', language: 'Go', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20026.action', 'devcloud2018.codeci_action_20018.action'] },
      { id: 'TV-10', language: 'PHP', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20037.action', 'devcloud2018.codeci_action_20018.action'] },
      { id: 'TV-11', language: 'C/C++/CMake', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20005.action', 'devcloud2018.codeci_action_20018.action'] },
      { id: 'TV-12', language: 'C#/MSBuild', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20017.action', 'devcloud2018.codeci_action_20018.action'] },
      { id: 'TV-13', language: 'Scala/sbt', expectedSteps: 2, expectedModuleIds: ['devcloud2018.codeci_action_20017.action', 'devcloud2018.codeci_action_20018.action'] },
      { id: 'TV-14', language: '通用/自定义', expectedSteps: 1, expectedModuleIds: ['devcloud2018.codeci_action_20017.action'] },
      { id: 'TV-15', language: '纯镜像', expectedSteps: 1, expectedModuleIds: ['devcloud2018.codeci_action_20004.action'] },
      { id: 'TV-16', language: '产物传 OBS', expectedSteps: 1, expectedModuleIds: ['devcloud2018.codeci_action_20057.action'] },
      { id: 'TV-17', language: '从 OBS 拉取', expectedSteps: 1, expectedModuleIds: ['devcloud2018.codeci_action_20063.action'] },
    ];

    for (const c of cases) {
      it(`${c.id}: language="${c.language}" → ${c.expectedSteps} 步`, () => {
        const steps = assembleSteps({ language: c.language });
        expect(steps).toHaveLength(c.expectedSteps);
        expect(steps.map((s) => s.module_id)).toEqual(c.expectedModuleIds);
        steps.forEach(expectValidStep);
      });
    }
  });

  describe('TV-E01: stepsPlan 自定义参数覆盖', () => {
    it('应覆盖默认 command/image', () => {
      const steps = assembleSteps({
        stepsPlan: [
          { step: 'maven-build', properties: { command: 'mvn clean package -DskipTests', image: 'maven3.5.3-jdk8-open' } },
          { step: 'upload-release', properties: { file: 'target/*.jar', buildVersion: '1.0.0' } },
        ],
      });
      expect(steps).toHaveLength(2);
      expect(steps[0].module_id).toBe('devcloud2018.codeci_action_20043.action');
      expect((steps[0].properties as Record<string, unknown>).command).toBe('mvn clean package -DskipTests');
      expect((steps[1].properties as Record<string, unknown>).file).toBe('target/*.jar');
      expect((steps[1].properties as Record<string, unknown>).buildVersion).toBe('1.0.0');
    });
  });

  describe('TV-E02: stepsPlan 多步自定义顺序', () => {
    it('应保留 3 步顺序', () => {
      const steps = assembleSteps({
        stepsPlan: [
          { step: 'maven-build' },
          { step: 'unit-report', properties: { file: 'target/surefire-reports/TEST-*.xml' } },
          { step: 'upload-release', properties: { file: 'target/*.jar', buildVersion: '1.0.0' } },
        ],
      });
      expect(steps).toHaveLength(3);
      expect(steps[0].module_id).toBe('devcloud2018.codeci_action_20043.action');
      expect(steps[1].module_id).toBe('devcloud2018.codeci_action_20071.action');
      expect(steps[2].module_id).toBe('devcloud2018.codeci_action_20018.action');
    });
  });

  describe('TV-E03: language 未匹配', () => {
    it('应抛 E_PARAM 并列出可用 language', () => {
      try {
        assembleSteps({ language: 'Rust' });
        expect.fail('应抛异常');
      } catch (e) {
        expect(e).toBeInstanceOf(ToolException);
        expect((e as ToolException).code).toBe('E_PARAM');
        expect((e as ToolException).details).toContain('可用 language');
      }
    });
  });

  describe('TV-E04: module_id 非白名单', () => {
    it('validateSteps 应抛 E_PARAM', () => {
      try {
        validateSteps([{ module_id: 'devcloud2018.codeci_action_99999.action', name: 'fake' }]);
        expect.fail('应抛异常');
      } catch (e) {
        expect(e).toBeInstanceOf(ToolException);
        expect((e as ToolException).code).toBe('E_PARAM');
        expect((e as ToolException).details).toContain('白名单');
      }
    });
  });

  describe('TV-E05: stepsPlan step 未匹配模板', () => {
    it('resolveStep 应抛 E_PARAM 并列出可用 template_id', () => {
      try {
        resolveStep('rust-build');
        expect.fail('应抛异常');
      } catch (e) {
        expect(e).toBeInstanceOf(ToolException);
        expect((e as ToolException).code).toBe('E_PARAM');
        // 2026-10-10：文案改为引导 stepsPlan 用 template_id（module_id 仅 steps 数组全限定名）
        expect((e as ToolException).details).toContain('template_id');
        expect((e as ToolException).details).toContain('npm-build');
        expect((e as ToolException).details).toContain('module_id');
      }
    });

    it('FE-15: pip-install 未匹配 → 推荐 shell-command/pyinstaller-build', () => {
      try {
        resolveStep('pip-install');
        expect.fail('应抛异常');
      } catch (e) {
        expect(e).toBeInstanceOf(ToolException);
        expect((e as ToolException).code).toBe('E_PARAM');
        // message 含模糊推荐（stepsPlan 场景模型直接看 message）
        expect((e as ToolException).message).toContain('推荐 template_id: shell-command, pyinstaller-build');
      }
    });

    it('FE-15: code-checkout 未匹配 → 提示无需 checkout 步骤（建仓推码已完成）', () => {
      try {
        resolveStep('code-checkout');
        expect.fail('应抛异常');
      } catch (e) {
        expect(e).toBeInstanceOf(ToolException);
        expect((e as ToolException).message).toContain('无需 checkout 步骤');
      }
    });

    it('FE-15: suggestTemplateRefs 对未知步骤返回 null', () => {
      expect(suggestTemplateRefs('rust-build')).toBeNull();
    });
  });

  describe('TV-E06: 三选一皆无', () => {
    it('assembleSteps 应抛 E_PARAM', () => {
      try {
        assembleSteps({});
        expect.fail('应抛异常');
      } catch (e) {
        expect(e).toBeInstanceOf(ToolException);
        expect((e as ToolException).code).toBe('E_PARAM');
        expect((e as ToolException).message).toContain('三者皆无');
      }
    });
  });

  describe('TV-E07: steps 显式透传（最高优先）', () => {
    it('assembleConfig 应使用 steps 忽略 stepsPlan', () => {
      const cfg = assembleConfig({
        projectId: 'test-project-id',
        jobName: 'test-job',
        arch: 'x86-64',
        steps: [
          {
            module_id: 'devcloud2018.codeci_action_20043.action',
            name: 'Maven构建',
            properties: { image: 'maven3.5.3-jdk8-open', command: 'mvn package', preCondition: 'SUCCESS' },
            enable: true,
          },
        ],
        stepsPlan: [{ step: 'npm-build' }],
      });
      expect(cfg.steps).toHaveLength(1);
      expect(cfg.steps[0].module_id).toBe('devcloud2018.codeci_action_20043.action');
      expect(cfg.project_id).toBe('test-project-id');
      expect(cfg.job_name).toBe('test-job');
      expect(cfg.arch).toBe('x86-64');
    });
  });

  describe('辅助函数', () => {
    it('listAvailableTemplates 应返回 14 模板', () => {
      expect(listAvailableTemplates()).toHaveLength(14);
    });

    it('listAvailableLanguages 应返回 17 组合', () => {
      expect(listAvailableLanguages()).toHaveLength(17);
    });

    it('listWhitelistModuleIds 应返回 20 白名单', () => {
      expect(listWhitelistModuleIds()).toHaveLength(20);
    });

    it('selectTemplates("Go") 应返回 ["go-build", "upload-release"]', () => {
      expect(selectTemplates('Go')).toEqual(['go-build', 'upload-release']);
    });
  });

  // ─── FE-11: _select 字段剥离（可用值枚举不进请求体）───

  describe('FE-11: _select 字段剥离', () => {
    it('stepsPlan 组装结果不含 _select 后缀字段（image_select 等不进请求体）', () => {
      const steps = assembleSteps({
        stepsPlan: [{ step: 'npm-build', properties: { command: 'npm ci && npm run build' } }],
      });
      expect(steps).toHaveLength(1);
      const props = steps[0].properties as Record<string, unknown>;
      // 业务参数保留
      expect(props.image).toBe('nodejs12.7.0');
      expect(props.command).toBe('npm ci && npm run build');
      expect(props.preCondition).toBe('SUCCESS');
      // _select 字段剥离
      expect(props.image_select).toBeUndefined();
      expect(Object.keys(props).filter((k) => k.endsWith('_select'))).toHaveLength(0);
    });

    it('language 组装结果不含 _select 后缀字段', () => {
      const steps = assembleSteps({ language: 'JavaScript/npm' });
      const props = steps[0].properties as Record<string, unknown>;
      expect(props.image).toBe('nodejs12.7.0');
      expect(props.image_select).toBeUndefined();
    });

    it('stepsPlan 覆盖 image 为 image_select 内的值（业务值不被误剥离）', () => {
      const steps = assembleSteps({
        stepsPlan: [{ step: 'npm-build', properties: { image: 'nodejs20' } }],
      });
      const props = steps[0].properties as Record<string, unknown>;
      // image=nodejs20 是业务值（在 image_select 数组内），不被剥离
      expect(props.image).toBe('nodejs20');
      // image_select 字段本身被剥离
      expect(props.image_select).toBeUndefined();
    });

    it('显式 steps 也剥离 _select（防模型从模板复制带入）', () => {
      const cfg = assembleConfig({
        projectId: 'p1',
        jobName: 'job1',
        arch: 'x86-64',
        steps: [
          {
            module_id: 'devcloud2018.codeci_action_20014.action',
            name: 'Npm构建',
            properties: { image: 'nodejs20', image_select: ['nodejs20', 'nodejs22'], command: 'npm run build', preCondition: 'SUCCESS' },
            enable: true,
          },
        ],
      });
      const props = cfg.steps[0].properties as Record<string, unknown>;
      expect(props.image).toBe('nodejs20');
      expect(props.image_select).toBeUndefined();
    });
  });

  describe('assembleConfig 完整流程', () => {
    it('language 速选 → 完整请求体', () => {
      const cfg = assembleConfig({
        projectId: 'p1',
        jobName: 'job1',
        arch: 'x86-64',
        language: 'Java/Maven（jar）',
      });
      expect(cfg.steps).toHaveLength(2);
      expect(cfg.steps[0].module_id).toBe('devcloud2018.codeci_action_20043.action');
      expect(cfg.host_type).toBe('devcloud');
      expect(cfg.build_config_type).toBe('ACTION');
      expect(cfg.build_if_code_updated).toBe(false);
      expect(cfg.auto_update_sub_module).toBe('false');
    });

    it('缺省 arch/projectId 应抛 E_PARAM', () => {
      // assembleConfig 不校验 arch/projectId（由 schemastery + handler 校验）
      // 但 steps 缺失时应抛 E_PARAM
      try {
        assembleConfig({
          projectId: 'p1',
          jobName: 'job1',
          arch: 'x86-64',
        } as never);
        expect.fail('应抛异常');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
      }
    });
  });

  // ─── 2026-10-10（FE-11 延伸）：image 可用值白名单校验（c6ca1e11 会话臆造 nodejs18.0.0 等致 6 轮空转）───

  describe('image 可用值校验（validateSteps）', () => {
    it('image 在 image_select 枚举内 → 放行', () => {
      const cfg = assembleConfig({
        projectId: 'p1',
        jobName: 'job1',
        arch: 'x86-64',
        steps: [
          {
            module_id: 'devcloud2018.codeci_action_20014.action',
            name: 'Npm构建',
            properties: { image: 'nodejs20' },
            enable: true,
          },
        ],
      });
      expect(cfg.steps[0].properties.image).toBe('nodejs20');
    });

    it('image 不在 image_select 枚举内（臆造 nodejs18.0.0）→ E_PARAM 列可用镜像', () => {
      try {
        assembleConfig({
          projectId: 'p1',
          jobName: 'job1',
          arch: 'x86-64',
          steps: [
            {
              module_id: 'devcloud2018.codeci_action_20014.action',
              name: 'Npm构建',
              properties: { image: 'nodejs18.0.0' },
              enable: true,
            },
          ],
        });
        expect.fail('应抛异常');
      } catch (e) {
        expect(e).toBeInstanceOf(ToolException);
        expect((e as ToolException).code).toBe('E_PARAM');
        expect((e as ToolException).message).toContain('不在可用镜像列表');
        expect((e as ToolException).details).toContain('nodejs20');
      }
    });

    it('stepsPlan 覆盖 image 为臆造值 → E_PARAM（同步骤白名单）', () => {
      try {
        assembleSteps({
          stepsPlan: [{ step: 'npm-build', properties: { image: 'nodejs99' } }],
        });
        expect.fail('应抛异常');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
        expect((e as ToolException).message).toContain('不在可用镜像列表');
      }
    });

    it('模板无 image_select 时覆盖 image → E_PARAM（无参照枚举即臆造风险）', () => {
      try {
        assembleSteps({
          stepsPlan: [{ step: 'upload-release', properties: { image: 'custom-image:v1' } }],
        });
        expect.fail('应抛异常');
      } catch (e) {
        expect(e).toBeInstanceOf(ToolException);
        expect((e as ToolException).code).toBe('E_PARAM');
        expect((e as ToolException).message).toContain('覆盖不被支持');
      }
    });

    it('模板无 image_select 但 image=默认值 → 放行（不误拦默认）', () => {
      const steps = assembleSteps({ stepsPlan: [{ step: 'upload-release' }] });
      expect(steps[0].properties.image).toBe('shell4.2.46-git1.8.3-zip6.00');
    });

    it('不覆盖 image（用默认值）→ 放行', () => {
      const steps = assembleSteps({ stepsPlan: [{ step: 'npm-build' }] });
      expect(steps[0].properties.image).toBe('nodejs12.7.0');
    });

    // ─── 2026-10-11（FE-12 P5）：前缀匹配推荐可用镜像（臆造 nodejs20.18.0 → 推荐 nodejs20 字面量）───

    it('臆造 nodejs20.18.0 → E_PARAM 且 details 推荐字面量 nodejs20', () => {
      try {
        assembleConfig({
          projectId: 'p1',
          jobName: 'job1',
          arch: 'x86-64',
          steps: [
            {
              module_id: 'devcloud2018.codeci_action_20014.action',
              name: 'Npm构建',
              properties: { image: 'nodejs20.18.0' },
              enable: true,
            },
          ],
        });
        expect.fail('应抛异常');
      } catch (e) {
        expect(e).toBeInstanceOf(ToolException);
        expect((e as ToolException).code).toBe('E_PARAM');
        const details = (e as ToolException).details as string;
        expect(details).toContain('nodejs20');
        expect(details).toContain('勿补全');
        expect(details).toContain('字面量');
      }
    });

    it('臆造 nodejs20.18.0 前缀匹配推荐 nodejs20（suggestClosestImage 边界）', () => {
      // nodejs20.18.0 → 前缀 nodejs20 命中推荐；断言推荐文案具体到 nodejs20 字面量
      try {
        assembleSteps({ stepsPlan: [{ step: 'npm-build', properties: { image: 'nodejs20.18.0' } }] });
        expect.fail('应抛异常');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
        const details = (e as ToolException).details as string;
        expect(details).toContain('nodejs20');
        // 推荐文案是"请用字面量 \`nodejs20\`（勿补全）"——不出现对其他候选的"请用字面量"
        expect(details).not.toContain('请用字面量 `nodejs18`');
        expect(details).not.toContain('请用字面量 `nodejs2`');
      }
    });

    it('合法字面量 nodejs20 → 放行（字面量照抄，不补全）', () => {
      const steps = assembleSteps({ stepsPlan: [{ step: 'npm-build', properties: { image: 'nodejs20' } }] });
      expect(steps[0].properties.image).toBe('nodejs20');
    });
  });

  // ─── FE-16 §2.1：step 字段契约机制化（properties 键名校验，2026-11-03 会话 e3c9f738）───
  describe('FE-16: step properties 键名校验（validateStepProperties）', () => {
    it('shell-command 模板传 command → 放行（合法字段名）', () => {
      const steps: Parameters<typeof validateSteps>[0] = [
        {
          module_id: 'devcloud2018.codeci_action_20017.action',
          name: '构建',
          properties: { command: 'uv build', preCondition: 'SUCCESS' },
          enable: true,
        },
      ];
      expect(() => validateSteps(steps)).not.toThrow();
    });

    it('shell-command 模板传 shellContent（非数组层字段名）→ E_PARAM + 推荐 command', () => {
      // 会话 e3c9f738 实测：模型在 steps[].properties 中用 shellContent（stepsPlan 语法层的字段名）
      // 服务端静默吞掉 → 回读发现命令是默认 echo 'hello'。FE-16 §2.1 机制化拦截。
      try {
        validateSteps([
          {
            module_id: 'devcloud2018.codeci_action_20017.action',
            name: '构建',
            properties: { shellContent: 'uv build', preCondition: 'SUCCESS' },
            enable: true,
          },
        ]);
        expect.fail('应抛 E_PARAM');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
        const details = (e as ToolException).details as string;
        // 错误信息含模板可用字段 + 推荐 command
        expect(details).toContain('shellContent');
        expect(details).toContain('shell-command');
        expect(details).toContain('command');
        // 软提示：区分两层语法
        expect(details).toContain('stepsPlan');
        expect(details).toContain('数组层');
      }
    });

    it('shell-command 模板传 comand（拼写错误）→ E_PARAM + 编辑距离推荐 command', () => {
      try {
        validateSteps([
          {
            module_id: 'devcloud2018.codeci_action_20017.action',
            name: '构建',
            properties: { comand: 'uv build' },
            enable: true,
          },
        ]);
        expect.fail('应抛 E_PARAM');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
        const details = (e as ToolException).details as string;
        // 编辑距离 ≤ 2 → 推荐 command
        expect(details).toContain('command');
      }
    });

    it('shell-command 模板传大小写不敏感 Command → E_PARAM + 推荐 command（保守拦截）', () => {
      // 大小写不敏感匹配仅用于推荐正确字段名，不用于放行——服务端字段名大小写敏感性未知，保守拦截
      try {
        validateSteps([
          {
            module_id: 'devcloud2018.codeci_action_20017.action',
            name: '构建',
            properties: { Command: 'uv build' },
            enable: true,
          },
        ]);
        expect.fail('应抛 E_PARAM（大小写不敏感匹配仅用于推荐，不放行）');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
        const details = (e as ToolException).details as string;
        // 大小写不敏感完全匹配 → 推荐 command
        expect(details).toContain('command');
      }
    });

    it('shell-command 模板传完全无关字段 xyz → E_PARAM 列出可用字段（无推荐）', () => {
      try {
        validateSteps([
          {
            module_id: 'devcloud2018.codeci_action_20017.action',
            name: '构建',
            properties: { xyz: 'value' },
            enable: true,
          },
        ]);
        expect.fail('应抛 E_PARAM');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
        const details = (e as ToolException).details as string;
        expect(details).toContain('xyz');
        expect(details).toContain('command');
        expect(details).toContain('preCondition');
      }
    });

    it('maven-build 模板传 pomMode → 放行（maven 模板合法字段）', () => {
      // 验证非 shell-command 模板的字段校验也生效
      expect(() =>
        validateSteps([
          {
            module_id: 'devcloud2018.codeci_action_20043.action',
            name: 'Maven构建',
            properties: { command: 'mvn clean package', pomMode: 'parent' },
            enable: true,
          },
        ]),
      ).not.toThrow();
    });

    it('maven-build 模板传 shellContent（跨模板字段名混淆）→ E_PARAM', () => {
      try {
        validateSteps([
          {
            module_id: 'devcloud2018.codeci_action_20043.action',
            name: 'Maven构建',
            properties: { shellContent: 'mvn clean package' },
            enable: true,
          },
        ]);
        expect.fail('应抛 E_PARAM');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
        const details = (e as ToolException).details as string;
        // shellContent 包含 command → 推荐 command（maven-build 模板的合法字段）
        expect(details).toContain('shellContent');
        expect(details).toContain('command');
      }
    });

    it('steps 多步混合：第 2 步字段错误 → E_PARAM 指明 steps[1]', () => {
      try {
        validateSteps([
          {
            module_id: 'devcloud2018.codeci_action_20017.action',
            name: '安装依赖',
            properties: { command: 'pip install uv' },
            enable: true,
          },
          {
            module_id: 'devcloud2018.codeci_action_20017.action',
            name: '构建',
            properties: { shellContent: 'uv build' }, // 第 2 步字段错误
            enable: true,
          },
        ]);
        expect.fail('应抛 E_PARAM');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
        const msg = (e as ToolException).message;
        expect(msg).toContain('steps[1]');
      }
    });

    it('assembleConfig 集成：steps[].properties.shellContent → E_PARAM（端到端拦截）', () => {
      // 验证 assembleConfig 内部调用 validateSteps 时也会拦截字段错误
      try {
        assembleConfig({
          projectId: 'p1',
          jobName: 'job1',
          arch: 'x86-64',
          steps: [
            {
              module_id: 'devcloud2018.codeci_action_20017.action',
              name: '构建',
              properties: { shellContent: 'uv build', image: 'shell4.2.46-git1.8.3-zip6.00' },
              enable: true,
            },
          ],
        });
        expect.fail('应抛 E_PARAM');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
        const details = (e as ToolException).details as string;
        expect(details).toContain('shellContent');
        expect(details).toContain('command');
      }
    });
  });

  // ─── FE-16 §2.4：language 速选模糊匹配（2026-11-03 会话 e3c9f738）───
  describe('FE-16: language 速选模糊匹配（selectTemplatesWithMatch）', () => {
    it('完全匹配 Python/PyInstaller → matchedBy:exact', () => {
      const r = selectTemplatesWithMatch('Python/PyInstaller');
      expect(r.matchedBy).toBe('exact');
      expect(r.matchedLanguage).toBe('Python/PyInstaller');
      expect(r.refs).toEqual(['pyinstaller-build', 'upload-release']);
    });

    it('前缀匹配 Python/uv → 命中 Python/其他（setuptools 等），matchedBy:prefix', () => {
      // 会话 e3c9f738 实测：模型传 Python/uv（不在枚举）→ 直接 E_PARAM 拒绝
      // FE-16 §2.4：前缀匹配 Python/ → 命中同前缀下的 Python/其他（setuptools 等）
      const r = selectTemplatesWithMatch('Python/uv');
      expect(r.matchedBy).toBe('prefix');
      expect(r.matchedLanguage).toBe('Python/其他（setuptools 等）');
      expect(r.refs).toEqual(['shell-command', 'upload-release']);
    });

    it('前缀匹配 Java/uv → 命中 Java/Maven（jar）（同前缀第一个）', () => {
      const r = selectTemplatesWithMatch('Java/uv');
      expect(r.matchedBy).toBe('prefix');
      expect(r.matchedLanguage).toBe('Java/Maven（jar）');
    });

    it('包含匹配：入参 Python（无 /，枚举键包含 Python）→ 命中含 Python 的第一个枚举键', () => {
      // contains 第二策略：枚举键包含入参——Python/PyInstaller.includes('Python') → true
      const r = selectTemplatesWithMatch('Python');
      expect(r.matchedBy).toBe('contains');
      expect(r.matchedLanguage).toContain('Python');
    });

    it('无前缀也无包含：Rust → matchedBy:none，抛 E_PARAM', () => {
      try {
        selectTemplatesWithMatch('Rust');
        expect.fail('应抛 E_PARAM');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
        const details = (e as ToolException).details as string;
        expect(details).toContain('可用 language');
        expect(details).toContain('stepsPlan'); // 引导改用 stepsPlan
      }
    });

    it('selectTemplates（旧 API）Python/uv → 返回 shell-command/upload-release（模糊匹配透传）', () => {
      // selectTemplates 旧 API 仍可用，内部走模糊匹配
      const refs = selectTemplates('Python/uv');
      expect(refs).toEqual(['shell-command', 'upload-release']);
    });

    it('selectTemplates Rust → E_PARAM（无匹配）', () => {
      try {
        selectTemplates('Rust');
        expect.fail('应抛 E_PARAM');
      } catch (e) {
        expect((e as ToolException).code).toBe('E_PARAM');
      }
    });

    it('assembleSteps language=Python/uv → 模糊匹配展开为 shell-command + upload-release', () => {
      // 端到端：assembleSteps 内部调 selectTemplates，模糊匹配后展开为 2 步
      const steps = assembleSteps({ language: 'Python/uv' });
      expect(steps.length).toBe(2);
      expect(steps[0].module_id).toBe('devcloud2018.codeci_action_20017.action'); // shell-command
      expect(steps[1].module_id).toBe('devcloud2018.codeci_action_20018.action'); // upload-release
    });
  });
});
