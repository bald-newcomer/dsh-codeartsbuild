/**
 * list-templates handler 单测（Layer 1，mock HttpClient，不需网络）
 * 覆盖 2026-11-06 精简：source 入参（custom/official/all）+ official 模板过滤 + 精简输出结构
 *   - 输出结构：combination_scenarios + custom_templates + official_templates + summary
 *   - 已移除：step_templates 字段、new_official_templates 字段、summary.step_count、summary.new_official_count
 * 对齐 api-contract.md §2.13
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listTemplatesHandler, type ListTemplatesHandlerInput } from '../src/providers/codeartsbuild/list-templates.js';
import type { CloudToolContext } from '../src/providers/codeartsbuild/context.js';

/** mock HttpClient（注入 call） */
const mockCall = vi.fn();

function makeCtx(): CloudToolContext {
  return { client: { call: mockCall } } as unknown as CloudToolContext;
}

function makeInput(overrides?: Partial<ListTemplatesHandlerInput>): ListTemplatesHandlerInput {
  return { ...overrides };
}

/** 构造 custom 接口返回项 */
function makeCustomItem(uuid: string, name: string) {
  return { uuid, name, description: `自定义模板 ${name}`, scope: 'PROJECT', type: 'build', steps: [] };
}

/** 构造 official 接口返回项（含 steps，每个 step 带 module_id） */
function makeOfficialItem(uuid: string, name: string, moduleIds: string[]) {
  return {
    uuid,
    name,
    description: `官方模板 ${name}`,
    template: {
      steps: moduleIds.map((mid) => ({ module_id: mid, name: `step-${mid}` })),
    },
  };
}

/** 已存在于本地 step-templates.json 的 module_id（取首个） */
const LOCAL_MODULE_ID = 'devcloud2018.codeci_action_20043.action';
/** 不存在于本地的 module_id（用于验证 new_official_templates） */
const NEW_MODULE_ID = 'devcloud2018.codeci_action_99999.action';
/** 未映射且含 200 段的 module_id（用于验证 official_step_templates 的 step-N 派生） */
const UNMAPPED_200_MODULE_ID = 'devcloud2018.codeci_action_20088.action';

beforeEach(() => {
  mockCall.mockReset();
});

describe('listTemplatesHandler', () => {
  describe('source=custom（缺省）', () => {
    it('成功：默认查 custom，返回 combination_scenarios + custom_templates + summary，不含 official', async () => {
      // 场景：source 缺省 → 查 /v1/template/custom；远端返回 2 个自定义模板
      // 预期：输出含 18 个组合 + custom_templates + summary；无 official_templates（2026-11-06 精简：移除 step_templates/new_official_templates）
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.method === 'GET' && req.path === '/v1/template/custom') {
          return Promise.resolve({
            result: {
              items: [makeCustomItem('c-1', 'tpl-a'), makeCustomItem('c-2', 'tpl-b')],
              total_size: 2,
            },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput());

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      // combination_scenarios：18 个组合
      expect(Array.isArray(data.combination_scenarios)).toBe(true);
      expect(data.combination_scenarios).toHaveLength(18);
      // custom_templates：远端 2 个
      expect(Array.isArray(data.custom_templates)).toBe(true);
      expect(data.custom_templates).toHaveLength(2);
      expect(data.custom_templates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ uuid: 'c-1', name: 'tpl-a' }),
          expect.objectContaining({ uuid: 'c-2', name: 'tpl-b' }),
        ]),
      );
      // 不含 official 相关字段
      expect(data).not.toHaveProperty('official_templates');
      // 2026-11-06 精简：已移除 step_templates / new_official_templates 字段
      expect(data).not.toHaveProperty('step_templates');
      expect(data).not.toHaveProperty('new_official_templates');
      // summary 计数（2026-11-06 精简：移除 step_count / new_official_count）
      expect(data.summary).toMatchObject({
        combination_count: 18,
        custom_count: 2,
        official_count: 0,
      });
      // 摘要文本（不含已移除的 "17 个 step 模板"）
      expect(result.content[0].text).toContain('list_templates');
      expect(result.content[0].text).toContain('18 个组合场景');
      expect(result.content[0].text).toContain('2 个自定义模板');
      expect(result.content[0].text).not.toContain('step 模板');
      // 只调用 custom 接口，不调用 official 接口
      const paths = mockCall.mock.calls.map((c) => c[0]?.path);
      expect(paths).toContain('/v1/template/custom');
      expect(paths).not.toContain('/v1/template/officialtemplates');
    });

    it('成功：source 显式传 custom，行为与缺省一致', async () => {
      // 场景：source='custom' 显式传值
      // 预期：行为与缺省一致，仅查 custom 接口
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/custom') {
          return Promise.resolve({ result: { items: [], total_size: 0 } });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'custom' }));

      expect(result.isError).toBe(false);
      const paths = mockCall.mock.calls.map((c) => c[0]?.path);
      expect(paths).toContain('/v1/template/custom');
      expect(paths).not.toContain('/v1/template/officialtemplates');
    });
  });

  describe('source=official', () => {
    it('成功：查 official，返回 official_templates + combination_scenarios，不含 custom_templates', async () => {
      // 场景：source='official'，official 返回 2 个模板（非过时名）
      // 预期：输出 official_templates + combination_scenarios；无 custom_templates
      //       2026-11-06 精简：移除 step_templates / new_official_templates，summary 移除 step_count / new_official_count
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: {
              items: [
                makeOfficialItem('o-1', 'official-a', [LOCAL_MODULE_ID]),
                makeOfficialItem('o-2', 'official-b', [LOCAL_MODULE_ID]),
              ],
              total_size: 2,
            },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'official' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data.official_templates).toHaveLength(2);
      // 字段级断言：official_templates 含具体 uuid/name
      expect(data.official_templates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ uuid: 'o-1', name: 'official-a' }),
          expect.objectContaining({ uuid: 'o-2', name: 'official-b' }),
        ]),
      );
      expect(data.combination_scenarios).toHaveLength(18);
      // 不含 custom
      expect(data).not.toHaveProperty('custom_templates');
      // 2026-11-06 精简：已移除 step_templates / new_official_templates
      expect(data).not.toHaveProperty('step_templates');
      expect(data).not.toHaveProperty('new_official_templates');
      // summary 计数：official_count 为过滤后的数量（2 个均非过时名 → 2）
      expect(data.summary).toMatchObject({
        official_count: 2,
        custom_count: 0,
      });
      // 只调用 official 接口
      const paths = mockCall.mock.calls.map((c) => c[0]?.path);
      expect(paths).toContain('/v1/template/officialtemplates');
      expect(paths).not.toContain('/v1/template/custom');
    });

    it('成功：official 含本地无的 module_id → 透传 official_templates（2026-11-06 精简：不再比对 module_id）', async () => {
      // 场景：official 返回 2 个模板，其中 1 个含 NEW_MODULE_ID（本地无）
      // 预期（2026-11-06 精简）：移除 new_official_templates 比对逻辑，
      //   official_templates 原样透传所有非过时模板（不按 module_id 过滤），summary 无 new_official_count
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: {
              items: [
                makeOfficialItem('o-local', 'official-local', [LOCAL_MODULE_ID]),
                makeOfficialItem('o-new', 'official-new', [NEW_MODULE_ID]),
              ],
              total_size: 2,
            },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'official' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      // official_templates 原样透传（含 NEW_MODULE_ID 项）
      expect(data.official_templates).toHaveLength(2);
      expect(data.official_templates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ uuid: 'o-new', name: 'official-new' }),
          expect.objectContaining({ uuid: 'o-local', name: 'official-local' }),
        ]),
      );
      // 2026-11-06 精简：不再输出 new_official_templates
      expect(data).not.toHaveProperty('new_official_templates');
      expect(data.summary).toMatchObject({ official_count: 2 });
      expect(data.summary).not.toHaveProperty('new_official_count');
    });

    it('成功：official 模板 steps 为空数组 → official_templates 透传，无 module_id 比对（2026-11-06 精简）', async () => {
      // 场景：official 返回模板但 steps 为空
      // 预期（2026-11-06 精简）：不再有 module_id 比对逻辑，official_templates 原样透传，summary 无 new_official_count
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: { items: [makeOfficialItem('o-empty', 'official-empty', [])], total_size: 1 },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'official' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data.official_templates).toHaveLength(1);
      expect(data).not.toHaveProperty('new_official_templates');
      expect(data.summary).not.toHaveProperty('new_official_count');
      expect(data.summary).toMatchObject({ official_count: 1 });
    });
  });

  describe('official_step_templates（2026-11-09 新增）', () => {
    it('成功：source=official 输出 official_step_templates，结构与 step-templates.json 对齐', async () => {
      // 场景：official 返回 1 个模板，含 2 个 step：mapped（20043）与 unmapped（20088）
      // 预期：official_step_templates 去重后 2 项；每项含 template_id/name/module_id/properties；
      //   mapped → maven-build，unmapped 200 段 → step-88；properties 取自 step.properties
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: {
              items: [
                {
                  uuid: 'o-1',
                  name: 'official-stepmix',
                  template: {
                    steps: [
                      { module_id: LOCAL_MODULE_ID, name: 'maven-step', properties: { command: 'mvn package' } },
                      { module_id: UNMAPPED_200_MODULE_ID, name: 'custom-step', properties: { command: 'echo hi' } },
                    ],
                  },
                },
              ],
              total_size: 1,
            },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'official' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      const stepTemplates = data.official_step_templates as Array<Record<string, unknown>>;
      // 去重后数量 = 2
      expect(stepTemplates).toHaveLength(2);
      // 每项含 template_id/name/module_id/properties（字段级断言）
      expect(stepTemplates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            template_id: 'maven-build',
            name: 'maven-step',
            module_id: LOCAL_MODULE_ID,
            properties: { command: 'mvn package' },
          }),
          expect.objectContaining({
            template_id: 'step-88',
            name: 'custom-step',
            module_id: UNMAPPED_200_MODULE_ID,
            properties: { command: 'echo hi' },
          }),
        ]),
      );
      // summary 含 official_step_count
      expect(data.summary).toMatchObject({ official_step_count: 2 });
    });

    it('成功：同一 module_id 在多个官方模板出现 → 去重只保留一次', async () => {
      // 场景：official 返回 3 个模板，均含 LOCAL_MODULE_ID；第 3 个额外含 UNMAPPED_200_MODULE_ID
      // 预期：official_step_templates 仅 2 项（module_id 去重）；保留首个出现的模板的 name/properties
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: {
              items: [
                makeOfficialItem('o-a', 'official-a', [LOCAL_MODULE_ID]),
                makeOfficialItem('o-b', 'official-b', [LOCAL_MODULE_ID]),
                {
                  uuid: 'o-c',
                  name: 'official-c',
                  template: {
                    steps: [
                      { module_id: LOCAL_MODULE_ID, name: 'first-name', properties: { command: 'first-cmd' } },
                      { module_id: UNMAPPED_200_MODULE_ID, name: 'extra-name', properties: { command: 'extra-cmd' } },
                    ],
                  },
                },
              ],
              total_size: 3,
            },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'official' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      const stepTemplates = data.official_step_templates as Array<Record<string, unknown>>;
      // 3 个模板共 4 个 step 出现，按 module_id 去重后仅 2 项
      expect(stepTemplates).toHaveLength(2);
      // 保留首个出现的 name/properties（o-a 的 step-LOCAL_MODULE_ID）
      const local = stepTemplates.find((s) => s.module_id === LOCAL_MODULE_ID);
      expect(local).toBeDefined();
      expect(local).toMatchObject({ name: `step-${LOCAL_MODULE_ID}` });
      expect(stepTemplates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ module_id: LOCAL_MODULE_ID }),
          expect.objectContaining({ module_id: UNMAPPED_200_MODULE_ID }),
        ]),
      );
      // summary 计数与去重后数量一致
      expect(data.summary).toMatchObject({ official_step_count: 2 });
    });

    it('成功：official 模板 steps 为空 → official_step_templates 为空数组，official_step_count=0', async () => {
      // 场景：official 仅返回无 steps 的模板
      // 预期：official_step_templates=[]，summary.official_step_count=0
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: { items: [makeOfficialItem('o-empty', 'official-empty', [])], total_size: 1 },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'official' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data.official_step_templates).toEqual([]);
      expect(data.summary).toMatchObject({ official_step_count: 0 });
    });

    it('成功：source=custom 时不输出 official_step_templates，summary 不含 official_step_count', async () => {
      // 场景：source=custom（缺省），远端仅返回自定义模板
      // 预期：输出不含 official_step_templates，summary 不含 official_step_count
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/custom') {
          return Promise.resolve({
            result: { items: [makeCustomItem('c-1', 'custom-a')], total_size: 1 },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput());

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data).not.toHaveProperty('official_step_templates');
      expect(data.summary).not.toHaveProperty('official_step_count');
    });

    it('成功：source=all 时输出 official_step_templates，official_step_count 计入摘要', async () => {
      // 场景：source=all，custom 返回 1 个，official 返回 1 个（含 mapped step）
      // 预期：输出含 official_step_templates（1 项），summary.official_step_count=1；custom 无此字段
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/custom') {
          return Promise.resolve({
            result: { items: [makeCustomItem('c-1', 'custom-all')], total_size: 1 },
          });
        }
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: { items: [makeOfficialItem('o-1', 'official-all', [LOCAL_MODULE_ID])], total_size: 1 },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'all' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      const stepTemplates = data.official_step_templates as Array<Record<string, unknown>>;
      expect(stepTemplates).toHaveLength(1);
      expect(stepTemplates[0]).toMatchObject({ module_id: LOCAL_MODULE_ID, template_id: 'maven-build' });
      expect(data.summary).toMatchObject({ official_step_count: 1 });
      // 两个接口均被调用
      const paths = mockCall.mock.calls.map((c) => c[0]?.path);
      expect(paths).toContain('/v1/template/custom');
      expect(paths).toContain('/v1/template/officialtemplates');
    });
  });

  describe('source=all', () => {
    it('成功：并行查两个接口，输出 custom_templates + official_templates + combination_scenarios', async () => {
      // 场景：source='all'，custom 返回 1 个，official 返回 1 个（含本地 module_id）
      // 预期（2026-11-06 精简）：输出含 custom_templates + official_templates + combination_scenarios
      //   移除 step_templates / new_official_templates 字段及 step_count / new_official_count 计数
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/custom') {
          return Promise.resolve({
            result: { items: [makeCustomItem('c-1', 'custom-all')], total_size: 1 },
          });
        }
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: { items: [makeOfficialItem('o-1', 'official-all', [LOCAL_MODULE_ID])], total_size: 1 },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'all' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data.custom_templates).toHaveLength(1);
      expect(data.official_templates).toHaveLength(1);
      expect(data.combination_scenarios).toHaveLength(18);
      // 2026-11-06 精简：已移除 step_templates / new_official_templates 字段
      expect(data).not.toHaveProperty('step_templates');
      expect(data).not.toHaveProperty('new_official_templates');
      expect(data.summary).toMatchObject({
        custom_count: 1,
        official_count: 1,
      });
      expect(data.summary).not.toHaveProperty('step_count');
      expect(data.summary).not.toHaveProperty('new_official_count');
      // 调用了两个接口
      const paths = mockCall.mock.calls.map((c) => c[0]?.path);
      expect(paths).toContain('/v1/template/custom');
      expect(paths).toContain('/v1/template/officialtemplates');
      // 摘要文本同时含自定义与官方
      expect(result.content[0].text).toContain('1 个自定义模板');
      expect(result.content[0].text).toContain('1 个官方模板');
    });
  });

  describe('combination_scenarios 结构', () => {
    it('每个组合含 scenario/steps/description', async () => {
      // 场景：验证 combination_scenarios 每项字段结构
      // 预期：每项含 scenario、steps（数组）、description
      mockCall.mockResolvedValue({ result: { items: [], total_size: 0 } });

      const result = await listTemplatesHandler(makeCtx(), makeInput());

      expect(result.isError).toBe(false);
      const combos = (result as { data: Record<string, unknown> }).data.combination_scenarios as Array<Record<string, unknown>>;
      expect(combos.length).toBeGreaterThan(0);
      const first = combos[0];
      expect(first).toHaveProperty('scenario');
      expect(first).toHaveProperty('steps');
      expect(first).toHaveProperty('description');
      expect(typeof first.scenario).toBe('string');
      expect(Array.isArray(first.steps)).toBe(true);
      expect(typeof first.description).toBe('string');
    });
  });

  describe('参数校验', () => {
    it('name 长度非法（>115）→ E_PARAM', async () => {
      // 场景：name 长度 116
      // 预期：isError=true，content 含 E_PARAM，未发起远端调用
      const result = await listTemplatesHandler(makeCtx(), makeInput({ name: 'x'.repeat(116) }));

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('E_PARAM');
      expect(result.content[0].text).toContain('name 长度非法');
      expect(mockCall).not.toHaveBeenCalled();
    });

    it('name 长度为 0 → E_PARAM', async () => {
      // 场景：name 空字符串
      // 预期：E_PARAM
      const result = await listTemplatesHandler(makeCtx(), makeInput({ name: '' }));

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('E_PARAM');
      expect(result.content[0].text).toContain('name 长度非法');
    });

    it('name 长度边界 115 → 通过校验', async () => {
      // 场景：name 长度 115（上界）
      // 预期：通过校验，正常调用远端
      mockCall.mockResolvedValue({ result: { items: [], total_size: 0 } });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ name: 'x'.repeat(115) }));

      expect(result.isError).toBe(false);
      expect(mockCall).toHaveBeenCalled();
    });

    it('name 长度边界 1 → 通过校验', async () => {
      // 场景：name 长度 1（下界）
      // 预期：通过校验，正常调用远端
      mockCall.mockResolvedValue({ result: { items: [], total_size: 0 } });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ name: 'x' }));

      expect(result.isError).toBe(false);
      expect(mockCall).toHaveBeenCalled();
    });

    it('page < 1 → E_PARAM', async () => {
      // 场景：page=0
      // 预期：E_PARAM
      const result = await listTemplatesHandler(makeCtx(), makeInput({ page: 0 }));

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('E_PARAM');
      expect(result.content[0].text).toContain('page 非法');
      expect(mockCall).not.toHaveBeenCalled();
    });

    it('page 边界 1 → 通过校验', async () => {
      // 场景：page=1（下界）
      // 预期：通过校验
      mockCall.mockResolvedValue({ result: { items: [], total_size: 0 } });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ page: 1 }));

      expect(result.isError).toBe(false);
    });

    it('pageSize > 100 → E_PARAM', async () => {
      // 场景：pageSize=101
      // 预期：E_PARAM
      const result = await listTemplatesHandler(makeCtx(), makeInput({ pageSize: 101 }));

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('E_PARAM');
      expect(result.content[0].text).toContain('pageSize 越界');
      expect(mockCall).not.toHaveBeenCalled();
    });

    it('pageSize < 1 → E_PARAM', async () => {
      // 场景：pageSize=0
      // 预期：E_PARAM
      const result = await listTemplatesHandler(makeCtx(), makeInput({ pageSize: 0 }));

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('E_PARAM');
      expect(result.content[0].text).toContain('pageSize 越界');
    });

    it('pageSize 边界 100 → 通过校验', async () => {
      // 场景：pageSize=100（上界）
      // 预期：通过校验
      mockCall.mockResolvedValue({ result: { items: [], total_size: 0 } });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ pageSize: 100 }));

      expect(result.isError).toBe(false);
    });

    it('query 透传：name/page/pageSize/filter/tags 作为 query 传入 client.call', async () => {
      // 场景：传入全部查询参数
      // 预期：client.call 收到 query 含 name/page/page_size/filter/tags
      mockCall.mockResolvedValue({ result: { items: [], total_size: 0 } });

      await listTemplatesHandler(
        makeCtx(),
        makeInput({ name: 'mytpl', page: 2, pageSize: 50, filter: 'flt', tags: 'tag1' }),
      );

      const callArg = mockCall.mock.calls[0][0];
      expect(callArg.method).toBe('GET');
      expect(callArg.path).toBe('/v1/template/custom');
      expect(callArg.query).toMatchObject({
        name: 'mytpl',
        page: 2,
        page_size: 50,
        filter: 'flt',
        tags: 'tag1',
      });
    });
  });

  describe('normalizeTemplate 防御性分支（字段缺省回退）', () => {
    it('custom 项字段缺省 → 回退 null/[]，不报错', async () => {
      // 场景：远端返回缺省字段的 item（无 uuid/name/template/steps/parameters 等）
      // 预期：normalizeTemplate 各字段回退 null 或 []，summary.custom_count 按返回条数计
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/custom') {
          return Promise.resolve({
            result: { items: [{ description: 'only-desc' }], total_size: 1 },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput());

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data.custom_templates).toHaveLength(1);
      expect(data.custom_templates[0]).toMatchObject({
        uuid: null,
        name: null,
        description: 'only-desc',
        steps: [],
        parameters: [],
      });
    });
  });

  describe('extractOfficialStepTemplates 防御性分支（step 字段缺省回退）', () => {
    it('step 缺 name/properties/module_id 未映射 → 回退 moduleId 与 {}，template_id 派生', async () => {
      // 场景：official 模板 step 缺 name、缺 properties、module_id 不在 MODULE_TO_TEMPLATE_ID（如 20099）
      // 预期：name 回退 module_id；properties 回退 {}；template_id 用 module_id 尾号派生为 step-99
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: {
              items: [
                {
                  uuid: 'o-fallback',
                  name: 'official-fallback',
                  template: { steps: [{ module_id: 'devcloud2018.codeci_action_20099.action' }] },
                },
              ],
              total_size: 1,
            },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'official' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data.official_step_templates).toHaveLength(1);
      expect(data.official_step_templates[0]).toMatchObject({
        template_id: 'step-99',
        name: 'devcloud2018.codeci_action_20099.action', // name 缺省 → 回退 moduleId
        module_id: 'devcloud2018.codeci_action_20099.action',
        properties: {}, // properties 缺省 → 回退 {}
      });
    });

    it('step module_id 无 200 数字 → template_id 回退为完整 module_id', async () => {
      // 场景：module_id 不含 200\d+ 数字（如自定义 ID 后缀），numMatch 为 null
      // 预期：template_id 派生为 `step-${moduleId}`（整段 module_id）
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: {
              items: [
                {
                  uuid: 'o-nonum',
                  name: 'official-nonum',
                  template: { steps: [{ module_id: 'custom.module.no-number.action' }] },
                },
              ],
              total_size: 1,
            },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'official' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data.official_step_templates[0]).toMatchObject({
        template_id: 'step-custom.module.no-number.action',
        name: 'custom.module.no-number.action',
        properties: {},
      });
    });

    it('两个模板含相同 module_id 的 step → 去重只保留一次', async () => {
      // 场景：两个 official 模板均含同一 module_id 的 step
      // 预期：official_step_templates 只保留 1 条（stepMap 去重）
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: {
              items: [
                makeOfficialItem('o-dup-1', 'official-dup-1', [LOCAL_MODULE_ID]),
                makeOfficialItem('o-dup-2', 'official-dup-2', [LOCAL_MODULE_ID]),
              ],
              total_size: 2,
            },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'official' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data.official_step_templates).toHaveLength(1);
      expect(data.official_step_templates[0]).toMatchObject({
        module_id: LOCAL_MODULE_ID,
        template_id: 'maven-build', // LOCAL_MODULE_ID 20043 → maven-build
      });
    });
  });

  describe('official 模板 steps 非数组的防御性分支', () => {
    it('official 模板 template.steps 为非数组 → normalizeTemplate 透传，不计入比对（2026-11-06 精简后无比对）', async () => {
      // 场景：official 返回的 template.steps 为字符串（异常数据）
      // 预期（2026-11-06 精简）：normalizeTemplate 透传该字符串；不再有 module_id 比对逻辑，
      //   official_templates 原样透传非过时模板，summary.official_count = 1
      mockCall.mockImplementation((req: { method: string; path: string }) => {
        if (req.path === '/v1/template/officialtemplates') {
          return Promise.resolve({
            result: {
              items: [
                {
                  uuid: 'o-malformed',
                  name: 'malformed-steps',
                  template: { steps: 'not-an-array' }, // 非数组 steps
                },
              ],
              total_size: 1,
            },
          });
        }
        return Promise.resolve({ result: { items: [] } });
      });

      const result = await listTemplatesHandler(makeCtx(), makeInput({ source: 'official' }));

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      // official_templates 透传，steps 字段原样为字符串（normalizeTemplate 的 ?? 不触发，因字符串非 nullish）
      expect(data.official_templates).toHaveLength(1);
      expect(data.official_templates[0]).toMatchObject({ uuid: 'o-malformed' });
      expect(data.official_templates[0]).toMatchObject({ steps: 'not-an-array' });
      // 2026-11-06 精简：不再输出 new_official_templates，summary 不含 new_official_count
      expect(data).not.toHaveProperty('new_official_templates');
      expect(data.summary).not.toHaveProperty('new_official_count');
      expect(data.summary).toMatchObject({ official_count: 1 });
    });
  });

  describe('远端调用异常', () => {
    it('远端接口抛异常 → mapToolError 归为 E_API', async () => {
      // 场景：client.call 抛普通异常
      // 预期：isError=true，content 含 E_API
      mockCall.mockRejectedValue(new Error('network down'));

      const result = await listTemplatesHandler(makeCtx(), makeInput());

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('E_API');
    });

    it('custom 接口返回 items 缺省（无 result）→ custom_templates 为空，不报错', async () => {
      // 场景：远端返回空对象
      // 预期：custom_templates 为空数组，summary.custom_count=0
      mockCall.mockResolvedValue({});

      const result = await listTemplatesHandler(makeCtx(), makeInput());

      expect(result.isError).toBe(false);
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data.custom_templates).toEqual([]);
      expect(data.summary).toMatchObject({ custom_count: 0 });
    });
  });
});
