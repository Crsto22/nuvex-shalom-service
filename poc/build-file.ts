import "dotenv/config";

import path from "node:path";

import ExcelJS from "exceljs";

import { OUT_DIR, ensureDirs } from "./lib/browser.js";

/**
 * Genera un Excel PRO MASIVO a partir de la plantilla oficial.
 * Uso:
 *   npx tsx poc/build-file.ts --out test-invalid.xlsx --rows '[{"destinatario":"00000000",...}]'
 */
type Row = {
  destinatario: string;
  telefono?: string;
  contacto?: string;
  telefonoContacto?: string;
  grr?: string;
  origen: string;
  destino: string;
  mercaderia: string;
  alto: number;
  ancho: number;
  largo: number;
  peso: number;
  cantidad: number;
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  ensureDirs();

  const template = path.join(OUT_DIR, "plantilla-shalom.xlsx");
  const outName = argValue("--out") ?? "test.xlsx";
  const rowsArg = argValue("--rows");
  const rowsFile = argValue("--rows-file");

  if (!rowsArg && !rowsFile) {
    console.error("Falta --rows (JSON) o --rows-file (ruta a JSON).");
    process.exitCode = 1;
    return;
  }

  let rowsPayload = rowsArg;
  if (!rowsPayload && rowsFile) {
    const fs = await import("node:fs");
    rowsPayload = fs.readFileSync(path.resolve(rowsFile), "utf8");
  }

  const rows = JSON.parse(rowsPayload ?? "[]") as Row[];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(template);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("La plantilla no tiene hojas.");

  // La plantilla oficial trae una fila de ejemplo real en la fila 2.
  // Se limpian todas las filas de datos antes de escribir (A..H y M; I..L son formulas).
  for (let line = 2; line <= 500; line += 1) {
    for (const column of ["A", "B", "C", "D", "E", "F", "G", "H", "M"]) {
      sheet.getCell(`${column}${line}`).value = null;
    }
  }

  rows.forEach((row, index) => {
    const line = index + 2;
    sheet.getCell(`A${line}`).value = row.destinatario;
    sheet.getCell(`B${line}`).value = row.telefono ?? "";
    sheet.getCell(`C${line}`).value = row.contacto ?? "";
    sheet.getCell(`D${line}`).value = row.telefonoContacto ?? "";
    sheet.getCell(`E${line}`).value = row.grr ?? "";
    sheet.getCell(`F${line}`).value = row.origen;
    sheet.getCell(`G${line}`).value = row.destino;
    sheet.getCell(`H${line}`).value = row.mercaderia;
    sheet.getCell(`I${line}`).value = row.alto;
    sheet.getCell(`J${line}`).value = row.ancho;
    sheet.getCell(`K${line}`).value = row.largo;
    sheet.getCell(`L${line}`).value = row.peso;
    sheet.getCell(`M${line}`).value = row.cantidad;
  });

  const target = path.join(OUT_DIR, outName);
  await workbook.xlsx.writeFile(target);
  console.log(`Generado: ${target} (${rows.length} fila/s)`);
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
