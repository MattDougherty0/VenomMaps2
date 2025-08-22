#!/usr/bin/env node
import "dotenv/config";
import fs from 'fs/promises';
import path from 'path';
import * as turf from '@turf/turf';
import XLSX from 'xlsx';
function slugifySci(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}
async function writeJSON(file, obj) {
    await ensureDir(path.dirname(file));
    await fs.writeFile(file, JSON.stringify(obj, null, 2));
}
function parseDate(dateStr) {
    if (!dateStr)
        return null;
    // Try various date formats
    const formats = [
        /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
        /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
        /^\d{1,2}\/\d{1,2}\/\d{4}$/, // M/D/YYYY
        /^\d{4}$/, // YYYY only
    ];
    for (const format of formats) {
        if (format.test(dateStr)) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                return date;
            }
        }
    }
    return null;
}
function isValidCoordinate(lat, lng) {
    return !isNaN(lat) && !isNaN(lng) &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180;
}
async function loadOccurrenceData(filePath) {
    console.log(`Loading occurrence data from ${filePath}...`);
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    console.log(`Loaded ${data.length} records`);
    const records = [];
    for (const row of data) {
        // Use the actual column names from the Excel file
        const sciName = row.final_species || row.final_subspecies || row.database_recorded_species || '';
        const lat = parseFloat(row.latitude || '');
        const lng = parseFloat(row.longitude || '');
        const date = row.date || row.Date || row.eventDate || row.EventDate || '';
        const source = row.source || row.Source || row.dataset || row.Dataset || '';
        if (sciName && isValidCoordinate(lat, lng)) {
            records.push({
                scientificName: sciName.trim(),
                latitude: lat,
                longitude: lng,
                date: date.toString(),
                source: source.toString(),
                ...row
            });
        }
    }
    console.log(`Validated ${records.length} records with coordinates`);
    return records;
}
async function generateIndividualSightings(records) {
    console.log('Generating individual sightings files...');
    // Group records by species
    const speciesGroups = {};
    for (const record of records) {
        const sci = slugifySci(record.scientificName);
        if (!speciesGroups[sci]) {
            speciesGroups[sci] = [];
        }
        speciesGroups[sci].push(record);
    }
    const sightingsDir = 'web/data/sightings';
    await ensureDir(sightingsDir);
    let totalSightings = 0;
    for (const [sci, speciesRecords] of Object.entries(speciesGroups)) {
        const features = speciesRecords.map(record => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [record.longitude, record.latitude]
            },
            properties: {
                ...record,
                date: record.date,
                source: record.source
            }
        }));
        const geojson = {
            type: 'FeatureCollection',
            features
        };
        const filePath = path.join(sightingsDir, `${sci}.json`);
        await writeJSON(filePath, geojson);
        console.log(`  ${sci}: ${features.length} sightings`);
        totalSightings += features.length;
    }
    console.log(`Generated ${Object.keys(speciesGroups).length} species files with ${totalSightings} total sightings`);
}
async function generateHeatMap(records) {
    console.log('Generating heat map...');
    // Create points for all records
    const features = records.map(record => turf.point([record.longitude, record.latitude], {
        date: record.date,
        source: record.source,
        scientificName: record.scientificName
    }));
    // Create a FeatureCollection instead of heatmap
    const heatMap = turf.featureCollection(features);
    const filePath = 'web/data/heat_all_r6.geojson';
    await writeJSON(filePath, heatMap);
    console.log(`Generated heat map with ${features.length} points`);
}
async function generateSightingsIndex(records) {
    console.log('Generating sightings index...');
    // Group by species and count
    const speciesCounts = {};
    for (const record of records) {
        const sci = slugifySci(record.scientificName);
        speciesCounts[sci] = (speciesCounts[sci] || 0) + 1;
    }
    const index = {
        totalSightings: records.length,
        speciesCount: Object.keys(speciesCounts).length,
        species: speciesCounts,
        generated: new Date().toISOString()
    };
    const filePath = 'web/data/sightings_index.json';
    await writeJSON(filePath, index);
    console.log(`Generated sightings index with ${index.speciesCount} species`);
}
async function main() {
    try {
        // Try to load the clean data first, fall back to raw data
        let dataFile = 'combined_records_v4_clean.xlsx';
        if (!await fs.access(dataFile).then(() => true).catch(() => false)) {
            dataFile = 'combined_records_v4.xlsx';
        }
        if (!await fs.access(dataFile).then(() => true).catch(() => false)) {
            throw new Error('No occurrence data file found. Please ensure combined_records_v4.xlsx or combined_records_v4_clean.xlsx exists in the root directory.');
        }
        const records = await loadOccurrenceData(dataFile);
        if (records.length === 0) {
            throw new Error('No valid records found in the data file.');
        }
        await generateIndividualSightings(records);
        await generateHeatMap(records);
        await generateSightingsIndex(records);
        console.log('\n✅ Sightings generation complete!');
        console.log(`📁 Files generated in web/data/sightings/`);
        console.log(`🔥 Heat map: web/data/heat_all_r6.geojson`);
        console.log(`📊 Index: web/data/sightings_index.json`);
    }
    catch (error) {
        console.error('❌ Error generating sightings:', error);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=generate-sightings.js.map