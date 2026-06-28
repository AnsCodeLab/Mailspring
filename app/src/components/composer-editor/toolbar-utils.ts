// Pure, editor-independent helpers for the composer toolbar. No React, no Slate
// mutation — everything here is unit-tested in composer-toolbar-utils-spec.ts.

export const TOGGLE_MARK_TYPES = ['bold', 'italic', 'underline', 'strike'];
export const VALUE_MARK_TYPES = ['color', 'face', 'size'];
export const CHARACTER_MARK_TYPES = [...TOGGLE_MARK_TYPES, ...VALUE_MARK_TYPES];

const LEGACY_TO_PT: Record<number, number> = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24 };

export function ptFromMarkValue(val: any): string {
  if (!val && val !== 0) return '';
  if (typeof val === 'string' && val.endsWith('pt')) return val.slice(0, -2);
  if (typeof val === 'string' && val.endsWith('px'))
    return String(Math.round(parseInt(val, 10) * 0.75));
  if (typeof val === 'string' && val.endsWith('em'))
    return String(Math.round(parseFloat(val) * 12));
  if (typeof val === 'number') return String(LEGACY_TO_PT[val] || 12);
  return '';
}

const primaryFamily = (s: string) => String(s).toLowerCase().split(',')[0].trim();

export function faceFromMarkValue(val: any, options: { name: string; value: string }[]): string {
  if (!val) return '';
  const v = String(val).toLowerCase().trim();
  // Prefer an exact full-value match — this is what the dropdown stores, e.g.
  // "georgia, serif". Only fall back to comparing the PRIMARY family token so an
  // externally-pasted value like "Georgia" or "Times New Roman, serif" still resolves
  // to its option. We must NOT substring-match (the old bug): "georgia, serif" would
  // match the generic "serif"/"sans-serif" option and every font collapsed to a generic.
  let opt = options.find((o) => o.value.toLowerCase() === v);
  if (!opt) opt = options.find((o) => primaryFamily(o.value) === primaryFamily(val));
  return opt ? opt.value : String(val);
}

export function resolveDisplay(
  distinctDisplays: string[],
  fallback: string
): { display: string; mixed: boolean } {
  const distinct = distinctDisplays.filter((d) => d !== '' && d != null);
  if (distinct.length === 0) return { display: fallback, mixed: false };
  if (distinct.length === 1) return { display: distinct[0], mixed: false };
  return { display: '', mixed: true };
}

export interface CapturedMark {
  type: string;
  value?: any;
}

type MarkLike = { type: string; data: { get: (k: string) => any } };

export function captureCharacterMarks(marks: MarkLike[]): CapturedMark[] {
  return marks
    .filter((m) => CHARACTER_MARK_TYPES.includes(m.type))
    .map((m) => ({
      type: m.type,
      value: VALUE_MARK_TYPES.includes(m.type) ? m.data.get('value') : undefined,
    }));
}

// Returns the saved character marks (value scoped to value-types) that are NOT in
// presentTypes and are not the just-applied type — i.e. the marks that need re-adding
// after an apply. Callers that want to re-add ALL saved non-target marks unconditionally
// (e.g. the collapsed-cursor safety path) may pass an empty presentTypes set.
export function marksToReapply(
  saved: MarkLike[],
  presentTypes: Set<string>,
  appliedType: string
): CapturedMark[] {
  return saved
    .filter((m) => m.type !== appliedType && !presentTypes.has(m.type))
    .map((m) => ({
      type: m.type,
      value: VALUE_MARK_TYPES.includes(m.type) ? m.data.get('value') : undefined,
    }));
}

export function canCopyOrCut(isCollapsed: boolean): boolean {
  return !isCollapsed;
}

export function canPaint(captured: CapturedMark[]): boolean {
  return captured.length > 0;
}
