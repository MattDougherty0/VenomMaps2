import fs from 'fs/promises';
import path from 'path';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
function gunzipMaybe(buf, ext) {
    if (ext.endsWith('.gz')) {
        const zlib = require('zlib');
        return zlib.gunzipSync(buf);
    }
    return buf;
}
export async function readRowsGeneric(file) {
    const ext = path.extname(file).toLowerCase();
    const ext2 = file.toLowerCase().endsWith('.csv.gz') || file.toLowerCase().endsWith('.tsv.gz') || file.toLowerCase().endsWith('.ndjson.gz') || file.toLowerCase().endsWith('.geojson.gz');
    const raw = await fs.readFile(file);
    const buf = ext2 ? gunzipMaybe(raw, file) : raw;
    const text = buf.toString('utf8');
    if (file.toLowerCase().endsWith('.csv') || file.toLowerCase().endsWith('.csv.gz') || file.toLowerCase().endsWith('.tsv') || file.toLowerCase().endsWith('.tsv.gz')) {
        const delim = file.toLowerCase().includes('.tsv') ? '\t' : ',';
        const res = Papa.parse(text, { header: true, delimiter: delim });
        return res.data.filter(Boolean);
    }
    if (file.toLowerCase().endsWith('.ndjson') || file.toLowerCase().endsWith('.ndjson.gz')) {
        return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    }
    if (file.toLowerCase().endsWith('.geojson') || file.toLowerCase().endsWith('.geojson.gz')) {
        const j = JSON.parse(text);
        if (j && j.type === 'FeatureCollection')
            return j.features.map((f) => ({ ...(f.properties || {}), decimalLatitude: f.geometry?.coordinates?.[1], decimalLongitude: f.geometry?.coordinates?.[0] }));
        return [];
    }
    if (ext === '.xlsx') {
        const wb = XLSX.read(buf, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        return json;
    }
    return [];
}
//# sourceMappingURL=readers.js.map