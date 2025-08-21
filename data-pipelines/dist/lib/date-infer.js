const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function toInt(v) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
export function fromISOOrParts(record, iso, y, m, d) {
    if (iso) {
        const dt = new Date(iso);
        if (!isNaN(dt.getTime())) {
            return { date: dt.toISOString().slice(0, 10), year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate(), confidence: 'high' };
        }
    }
    if (y && m && d) {
        const s = `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
        const dt = new Date(s);
        if (!isNaN(dt.getTime()))
            return { date: s, year: y, month: m, day: d, confidence: 'high' };
    }
    return null;
}
export function fromExcelSerial(serial) {
    if (!Number.isFinite(serial))
        return null;
    const epoch = Date.UTC(1899, 11, 30); // Excel's 1900 date system
    const ms = epoch + Math.floor(serial) * 24 * 3600 * 1000;
    const dt = new Date(ms);
    if (isNaN(dt.getTime()))
        return null;
    return { date: dt.toISOString().slice(0, 10), year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate(), confidence: 'text_inferred_full' };
}
export function monthFromName(s) {
    const i = MONTHS.indexOf(s.slice(0, 3).toLowerCase());
    return i >= 0 ? i + 1 : null;
}
const DATE_LIKE_KEY = /(date|observ|collect|record|time)/i;
const ISO_LIKE = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
const MON_YEAR = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+(\d{4})/i;
const MONTH_YEAR = /(January|February|March|April|May|June|July|August|September|October|November|December)[\s,]+(\d{4})/i;
const YEAR_ONLY = /(^|\D)(\d{4})(?!\d)/;
export function inferFromRecord(record) {
    // Look for any date-like string or Excel serials
    for (const [k, v] of Object.entries(record)) {
        if (!DATE_LIKE_KEY.test(k))
            continue;
        if (v == null || (typeof v === 'string' && v.trim() === ''))
            continue;
        // Direct JS Date
        if (v instanceof Date && !isNaN(v.getTime())) {
            return { date: v.toISOString().slice(0, 10), year: v.getUTCFullYear(), month: v.getUTCMonth() + 1, day: v.getUTCDate(), confidence: 'high' };
        }
        // Epoch milliseconds
        if (typeof v === 'number' && v > 24 * 3600 * 1000 && v < 1e13) {
            const dt = new Date(v);
            if (!isNaN(dt.getTime()))
                return { date: dt.toISOString().slice(0, 10), year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate(), confidence: 'text_inferred_full' };
        }
        const s = String(v ?? '').trim();
        // Excel serial
        const n = Number(s);
        if (Number.isFinite(n) && n > 59 && n < 60000) {
            const g = fromExcelSerial(n);
            if (g)
                return g;
        }
        // If range like YYYY-MM-DD/..., take first part
        const firstPart = s.split(/[\s,;]+|\//)[0];
        const mIso = firstPart.match(ISO_LIKE) || s.match(ISO_LIKE);
        if (mIso) {
            const yy = Number(mIso[1]);
            const mm = Number(mIso[2]);
            const dd = Number(mIso[3]);
            const candidate = `${yy.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}`;
            const dt = new Date(candidate);
            if (!isNaN(dt.getTime()))
                return { date: candidate, year: yy, month: mm, day: dd, confidence: 'text_inferred_full' };
        }
        const mMon = s.match(MON_YEAR) || s.match(MONTH_YEAR);
        if (mMon) {
            const mm = monthFromName(mMon[1]);
            const yy = Number(mMon[2]);
            if (mm)
                return { year: yy, month: mm, confidence: 'text_inferred_month' };
        }
    }
    // Year-only from free text across all string fields
    for (const v of Object.values(record)) {
        if (typeof v !== 'string')
            continue;
        const m = v.match(YEAR_ONLY);
        if (m) {
            const yy = Number(m[2]);
            if (yy >= 1800 && yy <= 2100)
                return { year: yy, confidence: 'text_inferred_year' };
        }
    }
    return { confidence: 'none' };
}
//# sourceMappingURL=date-infer.js.map