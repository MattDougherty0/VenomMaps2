#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { PATHS } from '@avoid-snakes/config';
import { cellToBoundary } from 'h3-js';
import { ensureDir } from '../lib/utils.js';
function toPolygonCoords(h3) {
    const boundary = cellToBoundary(h3, true); // [lat,lon]
    const ring = boundary.map(([lat, lon]) => [lon, lat]);
    if (ring.length)
        ring.push(ring[0]);
    return [ring];
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
    const agg = new Map();
    let total = 0, kept = 0;
    for (const line of lines) {
        total++;
        let rec;
        try {
            rec = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (!rec || !rec.inUS)
            continue;
        const h = rec.h3_r6 || null;
        if (!h)
            continue;
        kept++;
        const a = agg.get(h) || { count: 0 };
        a.count += 1;
        agg.set(h, a);
    }
    const features = Array.from(agg.entries()).map(([h3, a]) => ({
        type: 'Feature',
        properties: { h3, count: a.count },
        geometry: { type: 'Polygon', coordinates: toPolygonCoords(h3) }
    }));
    const fc = { type: 'FeatureCollection', features };
    await ensureDir(path.resolve(PATHS.webData));
    const outPath = path.resolve(PATHS.webData, 'heat_all_r6.geojson');
    await fs.writeFile(outPath, JSON.stringify(fc));
    console.log('Heat-all: total', total, 'kept', kept, 'unique hexes', agg.size);
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=occurrence-heat-all.js.map