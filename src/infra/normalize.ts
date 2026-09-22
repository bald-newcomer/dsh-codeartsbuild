/**
 * 输出规范化工具（snake_case → camelCase + 状态枚举映射）
 * 对齐 tool-details.md §1.2（输出命名 camelCase）+ api-contract.md §4.1（状态映射表）
 */

/**
 * 递归将对象/数组的 snake_case 键转换为 camelCase（原样保留值）
 * @param preserveKeys 这些键名保持 snake_case 不转换（如 module_id/scm_type 契约标识，供 round-trip）
 */
export function snakeToCamel<T>(value: T, preserveKeys?: Set<string>): T {
  if (Array.isArray(value)) {
    return value.map((v) => snakeToCamel(v, preserveKeys)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[preserveKeys?.has(k) ? k : toCamel(k)] = snakeToCamel(v, preserveKeys);
    }
    return out as T;
  }
  return value;
}

/** snake_case → camelCase（下划线后字母大写，其余保留） */
export function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** 毫秒时间戳 → ISO 字符串（输入 number 或 null/undefined） */
export function toIso(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || typeof ms !== 'number' || Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/** build_no 统一转 number（API 可能返回 string，适配层转 number） */
export function toBuildNo(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

/** 统一状态枚举映射：ShowJobBuildRecordDetail / ListRecords result.status（契约 §4.1） */
export function mapRecordStatus(raw: string | null | undefined): string {
  switch (raw) {
    case 'STARTED':
      return 'RUNNING';
    case 'SCHEDULING':
      // 实调发现（2026-09-21）：ShowJobBuildRecordDetail 排队态返回 SCHEDULING
      return 'QUEUED';
    case 'SCHEDULED':
      // 实调发现（2026-09-21）：ShowJobBuildRecordDetail 排队态另一变体 SCHEDULED
      return 'QUEUED';
    case 'ABORTED':
      return 'CANCELED';
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILED':
      return 'FAILED';
    case 'ERROR':
      return 'ERROR';
    default:
      return raw ?? 'UNKNOWN';
  }
}

/** 统一状态枚举映射：ShowJobStepStatus result.workflow.status（契约 §4.1，wait_build 轮询） */
export function mapWorkflowStatus(raw: string | null | undefined, workflowError?: unknown): string {
  switch (raw) {
    case 'running':
      return 'RUNNING';
    case 'queued':
      return 'QUEUED';
    case 'completed':
      // completed 结合 workflow.error 判定：error 为取消类（用户取消/abort）→ CANCELED，否则 FAILED
      return isCancelError(workflowError) ? 'CANCELED' : workflowError ? 'FAILED' : 'SUCCESS';
    case 'aborted':
      return 'CANCELED';
    default:
      return raw ?? 'UNKNOWN';
  }
}

/** 判定 workflow.error 是否为取消类（实测 2026-09-21：stop 后 error={code:"COCT.0020003.450", reason:"用户取消任务执行"}） */
function isCancelError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; reason?: string; message?: string };
  const text = `${e.code ?? ''} ${e.reason ?? ''} ${e.message ?? ''}`;
  return /取消|abort|cancel/i.test(text);
}

/** 统一状态枚举映射：ListJob last_build_status（契约 §4.1） */
export function mapJobLastStatus(raw: string | null | undefined): string {
  switch (raw) {
    case 'red':
      return 'FAILED';
    case 'blue':
      return 'SUCCESS';
    case 'aborted':
      return 'CANCELED';
    case 'InQueue':
      return 'QUEUED';
    case 'building':
      return 'RUNNING';
    case 'none':
      return 'UNKNOWN';
    default:
      return raw ?? 'UNKNOWN';
  }
}

/** 终态判定集合（契约 §4.2） */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'SUCCESS',
  'FAILED',
  'ERROR',
  'CANCELED',
  'COMPLETED',
]);
