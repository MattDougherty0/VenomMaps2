import fs from 'fs/promises';
import path from 'path';

export function slugifySci(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeNDJSON(file: string, rows: unknown[]): Promise<void> {
  await ensureDir(path.dirname(file));
  const content = rows.map(r => JSON.stringify(r)).join('\n');
  await fs.writeFile(file, content);
}

export type ParsedDate = { date?: string; year?: number; month?: number; confidence: 'high'|'text_inferred'|'none' };

export function parseDateFields(rec: Record<string, any>): ParsedDate {
  const out: ParsedDate = { confidence: 'none' };
  const y = toInt(rec.year ?? rec.eventYear);
  const m = toInt(rec.month ?? rec.eventMonth);
  const d = toInt(rec.day);
  const eventDate = (rec.eventDate ?? rec['event date'] ?? rec.date) as string | undefined;
  if (eventDate) {
    const dt = new Date(eventDate);
    if (!isNaN(dt.getTime())) {
      out.date = dt.toISOString().slice(0,10);
      out.year = dt.getUTCFullYear();
      out.month = dt.getUTCMonth() + 1;
      out.confidence = 'high';
      return out;
    }
  }
  if (y && m && d) {
    const s = `${y.toString().padStart(4,'0')}-${m.toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) { out.date = s; out.year = y; out.month = m; out.confidence = 'high'; return out; }
  }
  if (y && m) { out.year = y; out.month = m; }
  // conservative text inference from verbatimEventDate or remarks
  const verb = (rec.verbatimEventDate ?? rec.occurrenceRemarks ?? '') as string;
  if (verb) {
    const m1 = verb.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m1) {
      const yy = Number(m1[1]); const mm = Number(m1[2]); const dd = Number(m1[3]);
      const s = `${yy.toString().padStart(4,'0')}-${mm.toString().padStart(2,'0')}-${dd.toString().padStart(2,'0')}`;
      out.date = s; out.year = yy; out.month = mm; out.confidence = 'text_inferred';
      return out;
    }
    const m2 = verb.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
    if (m2) {
      const mm = monthFromStr(m2[1]); const yy = Number(m2[2]);
      out.year = yy; out.month = mm; out.confidence = 'text_inferred';
      return out;
    }
  }
  return out;
}

function monthFromStr(s: string): number { const n = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(s.slice(0,3).toLowerCase()); return n >= 0 ? n+1 : 1; }
function toInt(v: any): number | undefined { const n = Number(v); return Number.isFinite(n) ? n : undefined; }

export function parseIssues(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return String(raw).split(/[;,|]/).map(s => s.trim()).filter(Boolean);
}

export function isLikelyCaptive(rec: Record<string, any>): boolean {
  const flags = [rec.isCaptive, rec.captive, rec.inCaptivity];
  if (flags.some((v) => String(v).toLowerCase() === 'true' || v === true || v === '1')) return true;
  const remarks = String(rec.occurrenceRemarks ?? rec.remarks ?? '').toLowerCase();
  if (!remarks) return false;
  return /(captive|zoo|ex\s*situ|in\s*captivity)/i.test(remarks);
}


