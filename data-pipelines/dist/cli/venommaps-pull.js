#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { ACCEPTED_OCCURRENCE_EXTS } from '@avoid-snakes/config';
async function main() {
    const cfgPath = path.resolve('vendor/venommaps/config.json');
    let cfg = {};
    try {
        cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    }
    catch {
        console.log('No vendor/venommaps/config.json found yet. Create it with distributionsDir, occurrenceDir, etc.');
    }
    const distDir = typeof cfg.distributionsDir === 'string' && cfg.distributionsDir ? path.resolve(cfg.distributionsDir) : null;
    const combinedPath = typeof cfg.combinedDistributionsPath === 'string' && cfg.combinedDistributionsPath ? path.resolve(cfg.combinedDistributionsPath) : null;
    const occDir = typeof cfg.occurrenceDir === 'string' && cfg.occurrenceDir ? path.resolve(cfg.occurrenceDir) : null;
    let distCount = 0;
    if (distDir) {
        try {
            const ents = await fs.readdir(distDir);
            distCount = ents.filter(e => e.endsWith('.geojson')).length;
        }
        catch { }
    }
    let combinedOk = false;
    if (!distDir && combinedPath) {
        try {
            await fs.access(combinedPath);
            combinedOk = true;
        }
        catch { }
    }
    let occCount = 0;
    if (occDir) {
        try {
            const ents = await fs.readdir(occDir);
            occCount = ents.filter(e => ACCEPTED_OCCURRENCE_EXTS.includes(path.extname(e).toLowerCase())).length;
        }
        catch { }
    }
    console.log(`Distributions: ${distDir ?? (combinedOk ? combinedPath : 'N/A')} (${distDir ? distCount : (combinedOk ? 1 : 0)} file${(distDir ? distCount : (combinedOk ? 1 : 0)) === 1 ? '' : 's'})`);
    console.log(`Occurrences:   ${occDir ?? 'N/A'} (${occCount} files)`);
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=venommaps-pull.js.map