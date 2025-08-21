#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import * as turf from '@turf/turf';
import Papa from 'papaparse';
function slugifySci(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
function prettyFromSci(sci) {
    const words = sci.replace(/_/g, ' ').split(' ');
    return words.map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
}
async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}
async function readJSON(file) {
    return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function writeJSON(file, obj) {
    await ensureDir(path.dirname(file));
    await fs.writeFile(file, JSON.stringify(obj));
}
async function loadCommonMap(p) {
    if (!p)
        return {};
    try {
        const ext = path.extname(p).toLowerCase();
        const content = await fs.readFile(p, 'utf8');
        if (ext === '.json' || ext === '.geojson') {
            const j = JSON.parse(content);
            if (Array.isArray(j)) {
                const m = {};
                for (const r of j) {
                    const sci = slugifySci(String(r.scientificName ?? r.sci ?? ''));
                    const common = String(r.common ?? r.commonName ?? '');
                    if (sci && common)
                        m[sci] = common;
                }
                return m;
            }
            if (j && typeof j === 'object')
                return j;
        }
        if (ext === '.csv' || ext === '.tsv') {
            const res = Papa.parse(content, { header: true, delimiter: ext === '.tsv' ? '\t' : ',' });
            const m = {};
            for (const r of res.data) {
                const sci = slugifySci(String(r.scientificName ?? r.sci ?? ''));
                const common = String(r.common ?? r.commonName ?? '');
                if (sci && common)
                    m[sci] = common;
            }
            return m;
        }
    }
    catch { }
    return {};
}
async function processPerSpeciesDir(distDir, outDistDir, commonMap) {
    const entries = await fs.readdir(distDir);
    const species = [];
    const bboxMap = {};
    for (const name of entries.filter(e => e.endsWith('.geojson')).sort()) {
        const file = path.join(distDir, name);
        const sci = slugifySci(path.basename(name, '.geojson'));
        const dest = path.join(outDistDir, `${sci}.geojson`);
        try {
            const geo = await readJSON(file);
            await writeJSON(dest, geo);
            const bb = turf.bbox(geo);
            const r = (n) => Number(n.toFixed(6));
            bboxMap[sci] = [r(bb[0]), r(bb[1]), r(bb[2]), r(bb[3])];
            species.push({ sci, common: commonMap[sci] ?? prettyFromSci(sci) });
        }
        catch (e) {
            console.warn('Failed processing', name, e);
        }
    }
    species.sort((a, b) => a.common.localeCompare(b.common));
    await writeJSON('web/data/species_common.json', species);
    await writeJSON('web/data/distributions_bbox.json', bboxMap);
}
async function processCombinedFile(combinedPath, outDistDir, commonMap) {
    const fc = await readJSON(combinedPath);
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features))
        return;
    const groups = {};
    for (const f of fc.features) {
        const props = f.properties || {};
        const raw = String(props.scientificName ?? props.sci ?? '').trim();
        if (!raw)
            continue;
        const sci = slugifySci(raw);
        if (!groups[sci])
            groups[sci] = [];
        groups[sci].push(f);
    }
    const species = [];
    const bboxMap = {};
    for (const sci of Object.keys(groups).sort()) {
        const geo = { type: 'FeatureCollection', features: groups[sci] };
        const dest = path.join(outDistDir, `${sci}.geojson`);
        await writeJSON(dest, geo);
        const bb = turf.bbox(geo);
        const r = (n) => Number(n.toFixed(6));
        bboxMap[sci] = [r(bb[0]), r(bb[1]), r(bb[2]), r(bb[3])];
        species.push({ sci, common: commonMap[sci] ?? prettyFromSci(sci) });
    }
    species.sort((a, b) => a.common.localeCompare(b.common));
    await writeJSON('web/data/species_common.json', species);
    await writeJSON('web/data/distributions_bbox.json', bboxMap);
}
async function main() {
    const cfgPath = path.resolve('vendor/venommaps/config.json');
    let cfg = {};
    try {
        cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    }
    catch { }
    const distDir = cfg.distributionsDir ? path.resolve(cfg.distributionsDir) : null;
    const combinedPath = cfg.combinedDistributionsPath ? path.resolve(cfg.combinedDistributionsPath) : null;
    const commonMapPath = cfg.speciesCommonMapPath ? path.resolve(cfg.speciesCommonMapPath) : null;
    const outDistDir = path.resolve('web/data/distributions');
    await ensureDir(outDistDir);
    const commonMap = await loadCommonMap(commonMapPath);
    if (distDir) {
        await processPerSpeciesDir(distDir, outDistDir, commonMap);
        console.log('Assets built from per-species directory.');
    }
    else if (combinedPath) {
        await processCombinedFile(combinedPath, outDistDir, commonMap);
        console.log('Assets built from combined FeatureCollection.');
    }
    else {
        console.log('No distributions input configured. Skipping assets build.');
    }
    // Write provenance meta
    const meta = {
        sources: [
            {
                name: 'VenomMaps',
                url: 'https://github.com/RhettRautsaw/VenomMaps',
                license: 'CC BY 4.0',
                version: typeof cfg.version === 'string' && cfg.version ? cfg.version : 'dev',
                lastUpdated: typeof cfg.lastUpdated === 'string' && cfg.lastUpdated ? cfg.lastUpdated : new Date().toISOString()
            }
        ]
    };
    await writeJSON('web/meta.json', meta);
}
main().catch(err => { console.error(err); process.exit(1); });
//# sourceMappingURL=assets-ranges.js.map