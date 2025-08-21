#!/usr/bin/env node
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import bbox from '@turf/bbox';
import buffer from '@turf/buffer';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import RBush, { BBox } from 'rbush';
import { latLngToCell } from 'h3-js';
import { ensureDir, slugifySci, writeNDJSON } from '../lib/utils.js';
import { PATHS } from '@avoid-snakes/config';

type BoxItem = BBox & { geom: any };

type SpeciesIndex = { originalIdx: RBush<BoxItem>; bufferIdx: RBush<BoxItem> };

const speciesCache: Map<string, SpeciesIndex> = new Map();
const TARGET: Set<string> = (() => {
  try {
    const p = path.resolve('packages/config/target_species.json');
    const raw = fsSync.readFileSync(p, 'utf8');
    const arr = JSON.parse(raw);
    return new Set<string>(Array.isArray(arr) ? arr : []);
  } catch { return new Set<string>(); }
})();

async function loadSpeciesIndex(sciSlug: string): Promise<SpeciesIndex | null> {
  if (speciesCache.has(sciSlug)) return speciesCache.get(sciSlug)!;
  const distPath = path.resolve(PATHS.webData, 'distributions', `${sciSlug}.geojson`);
  let geo: any;
  try { geo = JSON.parse(await fs.readFile(distPath, 'utf8')); } catch { return null; }
  const features: any[] = Array.isArray(geo.features) ? geo.features : [];
  const originalIdx: RBush<BoxItem> = new RBush<BoxItem>();
  const bufferIdx: RBush<BoxItem> = new RBush<BoxItem>();
  const origItems: BoxItem[] = [];
  const buffItems: BoxItem[] = [];
  for (const f of features) {
    if (!f || !f.geometry) continue;
    const bb = bbox(f) as [number, number, number, number];
    origItems.push({ minX: bb[0], minY: bb[1], maxX: bb[2], maxY: bb[3], geom: f });
    try {
      const buffered = buffer(f as any, 10, { units: 'kilometers' });
      const bb2 = bbox(buffered) as [number, number, number, number];
      buffItems.push({ minX: bb2[0], minY: bb2[1], maxX: bb2[2], maxY: bb2[3], geom: buffered });
    } catch {}
  }
  originalIdx.load(origItems);
  bufferIdx.load(buffItems);
  const idx = { originalIdx, bufferIdx };
  speciesCache.set(sciSlug, idx);
  return idx;
}

function isInside(pt: any, idx: RBush<BoxItem>): boolean {
  const [x, y] = pt.geometry.coordinates as [number, number];
  const cands = idx.search({ minX: x, minY: y, maxX: x, maxY: y });
  for (const cand of cands) {
    try { if (booleanPointInPolygon(pt as any, cand.geom as any)) return true; } catch {}
  }
  return false;
}

async function main(): Promise<void>{
  const inPath = path.resolve(PATHS.outRoot, 'occurrences_normalized.ndjson');
  let text = '';
  try { text = await fs.readFile(inPath, 'utf8'); } catch {
    console.log('No normalized occurrences found at', inPath);
    return;
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const outRows: any[] = [];
  const perSpecies: Record<string, { total: number; inside: number }> = {};

  for (const line of lines) {
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || !rec.inUS) continue;
    const lat = Number(rec.decimalLatitude);
    const lon = Number(rec.decimalLongitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const sciSlug = slugifySci(String(rec.scientificName ?? ''));
    if (TARGET.size && !TARGET.has(sciSlug)) continue;
    let inside = false;
    if (sciSlug) {
      const idx = await loadSpeciesIndex(sciSlug);
      if (idx) {
        const pt = point([lon, lat]);
        inside = isInside(pt, idx.originalIdx) || isInside(pt, idx.bufferIdx);
      }
    }
    if (!perSpecies[sciSlug]) perSpecies[sciSlug] = { total: 0, inside: 0 };
    perSpecies[sciSlug].total++;
    if (inside) perSpecies[sciSlug].inside++;

    rec.insideExpertRange = inside;
    rec.h3_r6 = latLngToCell(lat, lon, 6);
    rec.h3_r5 = latLngToCell(lat, lon, 5);
    outRows.push(rec);
  }

  await ensureDir(PATHS.outRoot);
  await writeNDJSON(path.join(PATHS.outRoot, 'occurrences_enriched.ndjson'), outRows);

  // Log sanity for top species by volume
  const stats = Object.entries(perSpecies)
    .filter(([s]) => s)
    .map(([s, v]) => ({ sci: s, pct: v.total ? Math.round((v.inside / v.total) * 100) : 0, total: v.total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  for (const s of stats) console.log(`${s.sci}: insideExpertRange ${s.pct}% of ${s.total}`);

  console.log('Enriched occurrences:', outRows.length, 'rows');
}

main().catch(e => { console.error(e); process.exit(1); });


