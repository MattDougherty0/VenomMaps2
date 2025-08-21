#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { MAJOR_ISSUES_DEFAULT, STRICT_CONFIG, PATHS } from '@avoid-snakes/config';
import { ensureDir, writeNDJSON, slugifySci } from '../lib/utils.js';
import fsSync from 'fs';
function hasMajorIssues(issues) {
    const list = Array.isArray(issues) ? issues : String(issues || '').split(/[;,|]/).map(s => s.trim()).filter(Boolean);
    return list.some(it => MAJOR_ISSUES_DEFAULT.has(it));
}
function passDate(rec) {
    const conf = rec.dateConfidence || 'none';
    const y = Number(rec.eventYear);
    const m = rec.eventMonth ? Number(rec.eventMonth) : undefined;
    const d = rec.eventDay ? Number(rec.eventDay) : undefined;
    if ((conf === 'high' || conf === 'text_inferred_full') && Number.isFinite(y) && y >= STRICT_CONFIG.minYear) {
        const dd = d ?? 1;
        const mm = m ?? 1;
        return { ok: true, dateKey: `${y.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}`, tsMeta: 'high' };
    }
    if (STRICT_CONFIG.keepMonthApprox && conf === 'text_inferred_month' && Number.isFinite(y) && y >= STRICT_CONFIG.minYear && Number.isFinite(m)) {
        return { ok: true, dateKey: `${y.toString().padStart(4, '0')}-${Number(m).toString().padStart(2, '0')}-15`, tsMeta: 'approx_month' };
    }
    if (conf === 'text_inferred_year' && Number.isFinite(y) && y >= STRICT_CONFIG.minYear) {
        return { ok: true, dateKey: `${y.toString().padStart(4, '0')}-07-01`, tsMeta: 'approx_year' };
    }
    return { ok: false };
}
async function main() {
    const inPath = path.resolve(PATHS.outRoot, 'occurrences_enriched.ndjson');
    let text = '';
    try {
        text = await fs.readFile(inPath, 'utf8');
    }
    catch {
        console.log('No enriched occurrences found at', inPath);
        return;
    }
    const lines = text.split(/\r?\n/).filter(Boolean);
    const dedup = new Map();
    const TARGET = (() => {
        try {
            const raw = fsSync.readFileSync('packages/config/target_species.json', 'utf8');
            const arr = JSON.parse(raw);
            return new Set(Array.isArray(arr) ? arr : []);
        }
        catch {
            return new Set();
        }
    })();
    const audit = Object.create(null);
    const mark = (k) => { audit[k] = (audit[k] || 0) + 1; };
    for (const line of lines) {
        let rec;
        try {
            rec = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (!rec)
            continue;
        if (!rec.inUS) {
            mark('drop_not_inUS');
            continue;
        }
        const sci = slugifySci(String(rec.scientificName || ''));
        if (TARGET.size && !TARGET.has(sci)) {
            mark('drop_not_target');
            continue;
        }
        if (!rec.insideExpertRange) {
            mark('drop_outside_range');
            continue;
        }
        if (hasMajorIssues(rec.issues)) {
            mark('drop_issues');
            continue;
        }
        const unc = rec.coordinateUncertaintyInMeters;
        if (Number.isFinite(unc) && Number(unc) > STRICT_CONFIG.maxUncertaintyMeters) {
            mark('drop_uncertainty');
            continue;
        }
        if (rec.isCaptive) {
            mark('drop_captive');
            continue;
        }
        let basisRaw = String(rec.basisOfRecord || '');
        if (!basisRaw) {
            basisRaw = 'Observation';
            mark('missing_basis_kept');
        }
        const basisNorm = basisRaw.toLowerCase().replace(/[^a-z]/g, '');
        const allowedLower = new Set(Array.from(STRICT_CONFIG.allowedBasis.values()).map(s => String(s).toLowerCase().replace(/[^a-z]/g, '')));
        if (!allowedLower.has(basisNorm)) {
            mark('drop_bad_basis');
            continue;
        }
        const datePass = passDate(rec);
        if (!datePass.ok || !datePass.dateKey) {
            mark('drop_no_date');
            continue;
        }
        const lat = Number(rec.decimalLatitude);
        const lon = Number(rec.decimalLongitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            continue;
        const h3r6 = latLngToCell(lat, lon, 6);
        const h3r5 = latLngToCell(lat, lon, 5);
        const key = `${sci}|${datePass.dateKey}|${h3r6}`;
        if (!dedup.has(key))
            dedup.set(key, { count: 0, row: { sci, dateKey: datePass.dateKey, h3_r6: h3r6, h3_r5: h3r5, tsMeta: datePass.tsMeta } });
        dedup.get(key).count++;
    }
    // Emit canonical kept rows
    const outRows = Array.from(dedup.values()).map(v => ({ ...v.row }));
    await ensureDir(PATHS.outRoot);
    await writeNDJSON(path.join(PATHS.outRoot, 'recent_strict.ndjson'), outRows);
    // Emit sightings per species for UI
    const perSpecies = {};
    for (const [key, val] of dedup.entries()) {
        const [sci, dateKey, h3] = key.split('|');
        const [lat, lon] = cellToLatLng(h3);
        const ts = Date.parse(dateKey + 'T00:00:00Z');
        const arr = perSpecies[sci] || (perSpecies[sci] = []);
        const count = val.count > 1 ? val.count : undefined;
        arr.push({ lat, lon, ts, count });
    }
    const webDir = path.resolve(PATHS.webData, 'sightings');
    await ensureDir(webDir);
    const idx = [];
    for (const sci of Object.keys(perSpecies)) {
        const arr = perSpecies[sci];
        idx.push({ sci, count: arr.reduce((a, b) => a + (b.count ?? 1), 0) });
        await fs.writeFile(path.join(webDir, `${sci}.json`), JSON.stringify(arr));
    }
    await fs.writeFile(path.join(PATHS.webData, 'sightings_index.json'), JSON.stringify(idx.sort((a, b) => b.count - a.count)));
    console.log('Strict sightings written for', Object.keys(perSpecies).length, 'species');
    console.log('Strict audit:', audit);
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=occurrence-strict.js.map