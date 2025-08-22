#!/usr/bin/env node
import "dotenv/config";
import XLSX from 'xlsx';
async function debugExcel() {
    try {
        const filePath = 'combined_records_v4_clean.xlsx';
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        console.log(`Sheet name: ${sheetName}`);
        console.log(`Total rows: ${data.length}`);
        if (data.length > 0) {
            console.log('\nFirst row keys:');
            const firstRow = data[0];
            Object.keys(firstRow).forEach(key => {
                console.log(`  ${key}: ${firstRow[key]}`);
            });
            console.log('\nSample rows (first 3):');
            data.slice(0, 3).forEach((row, index) => {
                console.log(`\nRow ${index + 1}:`);
                Object.entries(row).forEach(([key, value]) => {
                    console.log(`  ${key}: ${value}`);
                });
            });
        }
    }
    catch (error) {
        console.error('Error debugging Excel file:', error);
    }
}
debugExcel();
//# sourceMappingURL=debug-excel.js.map