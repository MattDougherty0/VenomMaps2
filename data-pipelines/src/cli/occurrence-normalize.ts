#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import Papa from 'papaparse';
import { NormOccurrence } from '@avoid-snakes/schema';
import { FIELD_ALIASES, PATHS } from '@avoid-snakes/config';
import { parseIssues, isLikelyCaptive, ensureDir, writeNDJSON } from '../lib/utils.js';
import { fromISOOrParts, inferFromRecord } from '../lib/date-infer.js';
import { readRowsGeneric } from '../lib/readers.js';

type Metrics = {
  total: number;
  validCoord: number;
  inUS: number;
  dateBuckets: Record<string, number>;
  basis: Record<string, number>;
  columnsSeen: Record<string, number>;
};

function inc(map: Record<string, number>, key: string){ map[key] = (map[key] ?? 0) + 1; }

function normalizeHeaderKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function aliasGet(rec: Record<string, any>, target: keyof typeof FIELD_ALIASES): any {
  // direct exact hits first
  for (const k of FIELD_ALIASES[target]) {
    if (rec[k] != null && rec[k] !== '') return rec[k];
  }
  // case/format-insensitive lookup
  const normToValue: Record<string, any> = {};
  for (const [k, v] of Object.entries(rec)) normToValue[normalizeHeaderKey(k)] = v;
  for (const k of FIELD_ALIASES[target]) {
    const v = normToValue[normalizeHeaderKey(k)];
    if (v != null && v !== '') return v;
  }
  return undefined;
}

async function enumerateOccurrenceFiles(dir: string): Promise<string[]> {
  const ents = await fs.readdir(dir);
  return ents
    .filter(e => /(\.csv(\.gz)?|\.tsv(\.gz)?|\.ndjson(\.gz)?|\.geojson(\.gz)?|\.xlsx)$/i.test(e))
    .map(e => path.join(dir, e));
}

async function loadStates(): Promise<any> {
  try { return JSON.parse(await fs.readFile(PATHS.vendorStates, 'utf8')); } catch { return { type:'FeatureCollection', features: [] }; }
}

function joinState(lat: number, lon: number, statesFC: any): { stateCode?: string, inUS: boolean } {
  const pt = point([lon, lat]);
  for (const f of statesFC.features) {
    try {
      if (booleanPointInPolygon(pt as any, f as any)) {
        const stateCode = f.properties?.state_code ?? f.properties?.STATE ?? f.properties?.STUSPS;
        return { stateCode, inUS: true };
      }
    } catch {}
  }
  // Fallback: broad US bbox (AK/HI included)
  if (lat >= 18 && lat <= 72 && lon >= -179.5 && lon <= -66) {
    return { inUS: true };
  }
  return { inUS: false };
}

function detectSource(file: string): string {
  const s = file.toLowerCase();
  if (s.includes('inat')) return 'inat';
  if (s.includes('gbif')) return 'gbif';
  return 'venommaps';
}

function stableId(source: string, occurrenceId: string | undefined, idx: number, file: string): string {
  if (occurrenceId) return `${source}:${occurrenceId}`;
  return `${source}:${path.basename(file)}:${idx}`;
}

async function main(): Promise<void>{
  const cfgPath = path.resolve('vendor/venommaps/config.json');
  let cfg: any = {};
  try { cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8')); } catch {}
  const occDir: string | null = cfg.occurrenceDir ? path.resolve(cfg.occurrenceDir) : null;
  if (!occDir) { console.log('No occurrenceDir configured; skipping.'); return; }

  const states = await loadStates();
  const files = await enumerateOccurrenceFiles(occDir);
  const metrics: Metrics = { total: 0, validCoord: 0, inUS: 0, dateBuckets: {}, basis: {}, columnsSeen: {} };
  const outRows: any[] = [];

  for (const file of files) {
    const rows = await readRowsGeneric(file);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      for (const k of Object.keys(r)) inc(metrics.columnsSeen, k);
      metrics.total++;
      const lat = Number(aliasGet(r, 'decimalLatitude'));
      const lon = Number(aliasGet(r, 'decimalLongitude'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      metrics.validCoord++;

      const basis = String(aliasGet(r, 'basisOfRecord') ?? '').trim();
      if (basis) inc(metrics.basis, basis);

      const y = toInt(aliasGet(r, 'year'));
      const m = toInt(aliasGet(r, 'month'));
      const d = toInt(aliasGet(r, 'day'));
      const iso = aliasGet(r, 'eventDate');
      let guess = fromISOOrParts(r, typeof iso === 'string' ? iso : undefined, y ?? undefined, m ?? undefined, d ?? undefined);
      if (!guess) guess = inferFromRecord(r);

      const { stateCode, inUS } = joinState(lat, lon, states);
      if (inUS) metrics.inUS++;

      const out: any = {
        id: stableId(detectSource(file), String(aliasGet(r, 'occurrenceID') ?? ''), i, file),
        source: detectSource(file),
        scientificName: String(aliasGet(r, 'scientificName') ?? ''),
        commonName: undefined,
        eventDate: guess.date,
        eventYear: guess.year,
        eventMonth: guess.month,
        eventDay: guess.day,
        dateConfidence: guess.confidence,
        basisOfRecord: basis || undefined,
        isCaptive: isLikelyCaptive(r),
        decimalLatitude: lat,
        decimalLongitude: lon,
        coordinateUncertaintyInMeters: toInt(aliasGet(r, 'coordinateUncertaintyInMeters')),
        issues: parseIssues(aliasGet(r, 'issues')),
        stateCode,
        inUS
      };

      inc(metrics.dateBuckets, out.dateConfidence);
      try { NormOccurrence.parse(out); outRows.push(out); } catch {}
    }
  }

  await ensureDir(PATHS.outRoot);
  await writeNDJSON(path.join(PATHS.outRoot, 'occurrences_normalized.ndjson'), outRows);
  await ensureDir(PATHS.webData);
  await fs.writeFile(path.join(PATHS.webData, 'occurrence_columns_seen.json'), JSON.stringify(metrics.columnsSeen, null, 2));
  await fs.writeFile(path.join(PATHS.webData, 'occurrence_metrics_overall.json'), JSON.stringify({ total: metrics.total, validCoord: metrics.validCoord, inUS: metrics.inUS, dateBuckets: metrics.dateBuckets, basis: metrics.basis }, null, 2));
  console.log('Normalized occurrences:', outRows.length, 'rows');
}

function toInt(v: any): number | undefined { const n = Number(v); return Number.isFinite(n) ? n : undefined; }

main().catch(e => { console.error(e); process.exit(1); });


