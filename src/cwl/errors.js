export class CwlError extends Error {
  constructor(status, message, code = 'cwl_error') { super(message); this.status = status; this.code = code; }
}
export function requireCondition(condition, status, message, code) {
  if (!condition) throw new CwlError(status, message, code);
}
export function clanTag(value) {
  const tag = String(value || '').replace(/^#/, '').toUpperCase();
  requireCondition(/^[0289PYLQGRJCUV]{3,15}$/.test(tag), 400, 'Tag inválida.', 'invalid_tag');
  return tag;
}
export function warTime(value) {
  requireCondition(/^\d{8}T\d{6}\.000Z$/.test(value || ''), 400, 'Identificador de guerra inválido.', 'invalid_war');
  const ms = timestamp(value);
  requireCondition(Number.isFinite(ms) && new Date(ms).toISOString().replace(/[-:]/g, '') === value, 400, 'Data de guerra inválida.', 'invalid_war');
  return value;
}
export function timestamp(value) {
  return typeof value === 'number' ? value : Date.parse(String(value || '').replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6'));
}
