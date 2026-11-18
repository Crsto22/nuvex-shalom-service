import "dotenv/config";

import path from "node:path";

import ExcelJS from "exceljs";

import { OUT_DIR } from "./lib/browser.js";

async function main() {
  const file = path.resolve(process.argv[2] ?? path.join(OUT_DIR, "plantilla-shalom.xlsx"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);

  console.log(`Archivo: ${path.basename(file)}`);
  console.log(`Hojas: ${workbook.worksheets.map((sheet) => sheet.name).join(", ")}`);

  const sheet = workbook.worksheets[0];
  if (!sheet) return;

  console.log(`Dimension: ${sheet.rowCount} filas x ${sheet.columnCount} columnas`);

  for (const line of [1, 2, 3]) {
    const row = sheet.getRow(line);
    const values = row.values as unknown[];
    const cells = values.slice(1).map((value) => {
      if (value && typeof value === "object" && "formula" in (value as object)) {
        return `={${(value as { formula: string }).formula}}`;
      }
      if (value && typeof value === "object" && "richText" in (value as object)) {
        return (value as { richText: { text: string }[] }).richText.map((part) => part.text).join("");
      }
      return value === null || value === undefined ? "" : String(value);
    });
    console.log(`\nFila ${line}:`);
    cells.forEach((value, index) => {
      if (value !== "") console.log(`  ${String.fromCharCode(65 + index)}: ${value}`);
    });
  }

  const merges = (sheet as unknown as { model?: { merges?: string[] } }).model?.merges ?? [];
  if (merges.length) console.log(`\nCeldas combinadas: ${merges.slice(0, 12).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
