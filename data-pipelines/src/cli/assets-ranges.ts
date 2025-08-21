#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import * as turf from '@turf/turf';
import Papa from 'papaparse';

type SpeciesEntry = { sci: string; common: string };

function slugifySci(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function prettyFromSci(sci: string): string {
  const words = sci.replace(/_/g, ' ').split(' ');
  return words.map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readJSON<T = any>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

async function writeJSON(file: string, obj: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(obj));
}

async function loadCommonMap(p: string | null): Promise<Record<string, string>> {
  if (!p) return {};
  try {
    const ext = path.extname(p).toLowerCase();
    const content = await fs.readFile(p, 'utf8');
    if (ext === '.json' || ext === '.geojson') {
      const j = JSON.parse(content);
      if (Array.isArray(j)) {
        const m: Record<string, string> = {};
        for (const r of j) {
          const sci = slugifySci(String(r.scientificName ?? r.sci ?? ''));
          const common = String(r.common ?? r.commonName ?? '');
          if (sci && common) m[sci] = common;
        }
        return m;
      }
      if (j && typeof j === 'object') return j as Record<string, string>;
    }
    if (ext === '.csv' || ext === '.tsv') {
      const res = Papa.parse(content, { header: true, delimiter: ext === '.tsv' ? '\t' : ',' });
      const m: Record<string, string> = {};
      for (const r of res.data as any[]) {
        const sci = slugifySci(String(r.scientificName ?? r.sci ?? ''));
        const common = String(r.common ?? r.commonName ?? '');
        if (sci && common) m[sci] = common;
      }
      return m;
    }
  } catch {}
  return {};
}

async function processPerSpeciesDir(distDir: string, outDistDir: string, commonMap: Record<string, string>) {
  const entries = await fs.readdir(distDir);
  const species: SpeciesEntry[] = [];
  const bboxMap: Record<string, [number, number, number, number]> = {};

  for (const name of entries.filter(e => e.endsWith('.geojson')).sort()) {
    const file = path.join(distDir, name);
    const sci = slugifySci(path.basename(name, '.geojson'));
    const dest = path.join(outDistDir, `${sci}.geojson`);
    try {
      const geo = await readJSON<any>(file);
      await writeJSON(dest, geo);
      const bb = turf.bbox(geo) as [number, number, number, number];
      const r = (n: number) => Number(n.toFixed(6));
      bboxMap[sci] = [r(bb[0]), r(bb[1]), r(bb[2]), r(bb[3])];
      species.push({ sci, common: commonMap[sci] ?? prettyFromSci(sci) });
    } catch (e) {
      console.warn('Failed processing', name, e);
    }
  }

  species.sort((a, b) => a.common.localeCompare(b.common));
  await writeJSON('web/data/species_common.json', species);
  await writeJSON('web/data/distributions_bbox.json', bboxMap);
}

async function processCombinedFile(combinedPath: string, outDistDir: string, commonMap: Record<string, string>) {
  const fc = await readJSON<any>(combinedPath);
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return;
  const groups: Record<string, any[]> = {};
  for (const f of fc.features) {
    const props = f.properties || {};
    const raw = String(props.scientificName ?? props.sci ?? '').trim();
    if (!raw) continue;
    const sci = slugifySci(raw);
    if (!groups[sci]) groups[sci] = [];
    groups[sci].push(f);
  }
  const species: SpeciesEntry[] = [];
  const bboxMap: Record<string, [number, number, number, number]> = {};
  for (const sci of Object.keys(groups).sort()) {
    const geo = { type: 'FeatureCollection', features: groups[sci] };
    const dest = path.join(outDistDir, `${sci}.geojson`);
    await writeJSON(dest, geo);
    const bb = turf.bbox(geo) as [number, number, number, number];
    const r = (n: number) => Number(n.toFixed(6));
    bboxMap[sci] = [r(bb[0]), r(bb[1]), r(bb[2]), r(bb[3])];
    species.push({ sci, common: commonMap[sci] ?? prettyFromSci(sci) });
  }
  species.sort((a, b) => a.common.localeCompare(b.common));
  await writeJSON('web/data/species_common.json', species);
  await writeJSON('web/data/distributions_bbox.json', bboxMap);
}

async function main(): Promise<void> {
  const cfgPath = path.resolve('vendor/venommaps/config.json');
  let cfg: any = {};
  try { cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8')); } catch {}
  const distDir: string | null = cfg.distributionsDir ? path.resolve(cfg.distributionsDir) : null;
  const combinedPath: string | null = cfg.combinedDistributionsPath ? path.resolve(cfg.combinedDistributionsPath) : null;
  const commonMapPath: string | null = cfg.speciesCommonMapPath ? path.resolve(cfg.speciesCommonMapPath) : null;

  const outDistDir = path.resolve('web/data/distributions');
  await ensureDir(outDistDir);

  const commonMap = await loadCommonMap(commonMapPath);

  if (distDir) {
    await processPerSpeciesDir(distDir, outDistDir, commonMap);
    console.log('Assets built from per-species directory.');
  } else if (combinedPath) {
    await processCombinedFile(combinedPath, outDistDir, commonMap);
    console.log('Assets built from combined FeatureCollection.');
  } else {
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


