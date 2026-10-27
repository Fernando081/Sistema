export type JsonValue = string | number | boolean | null | JsonValue[] | AuditRecord;
export interface AuditRecord { [key: string]: JsonValue; }
export interface AuditChange { field: string; old: string; new: string; }

function equalJson(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => equalJson(item, right[index]));
  }
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}

function formatValue(value: JsonValue | undefined): string {
  if (value === undefined) return '(No existe)';
  return JSON.stringify(value);
}

export function auditDiff(oldRecord: AuditRecord | null, newRecord: AuditRecord | null, action: string): AuditChange[] {
  if (action === 'INSERT' && newRecord) return [{ field: '(Nuevo Registro)', old: '-', new: JSON.stringify(newRecord) }];
  if (action === 'DELETE' && oldRecord) return [{ field: '(Registro Borrado)', old: JSON.stringify(oldRecord), new: '-' }];
  if (action !== 'UPDATE' || !oldRecord || !newRecord) return [];
  const value = (record: AuditRecord, key: string): JsonValue | undefined =>
    Object.hasOwn(record, key) ? record[key] : undefined;
  return [...new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)])]
    .filter(key => !equalJson(value(oldRecord, key), value(newRecord, key)))
    .map(key => ({ field: key, old: formatValue(value(oldRecord, key)), new: formatValue(value(newRecord, key)) }));
}
