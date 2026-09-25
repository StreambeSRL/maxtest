// Genera archivos de ejemplo en data/samples para probar la importación.
import fs from "node:fs";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { chromium } from "playwright";

fs.mkdirSync("data/samples", { recursive: true });

fs.writeFileSync(
  "data/samples/casos.txt",
  "TC-10 Ordenar productos por precio\n  Pasos: en el catálogo elegir 'Price (low to high)'.\n  Esperado: los productos quedan ordenados ascendente.\n",
);
fs.writeFileSync(
  "data/samples/casos.csv",
  'ID,Titulo,Pasos,Esperado\n12345,Logout,"Abrir menú, tocar Logout","Vuelve al login"\n12346,Carrito vacío,"Abrir carrito sin productos","No hay ítems"\n',
);

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ["ID", "Título", "Pasos", "Resultado esperado"],
  [20001, "Checkout con datos válidos", "Agregar producto, ir a checkout, completar nombre/apellido/CP, continuar, finalizar", "Mensaje Thank you for your order"],
  [20002, "Checkout sin código postal", "Dejar CP vacío y continuar", "Error: Postal Code is required"],
]);
XLSX.utils.book_append_sheet(wb, ws, "Casos");
XLSX.writeFile(wb, "data/samples/casos.xlsx");

// DOCX mínimo (document.xml + content types + rels)
const zip = new JSZip();
zip.file(
  "[Content_Types].xml",
  `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
);
zip.file(
  "_rels/.rels",
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
);
const paras = [
  "Historia de usuario HU-7",
  "Como cliente quiero ver el detalle de un producto para decidir la compra.",
  "Criterios de aceptación: al tocar el nombre del producto se abre el detalle con imagen, descripción y precio; el botón Add to cart funciona desde el detalle.",
]
  .map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`)
  .join("");
zip.file(
  "word/document.xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`,
);
fs.writeFileSync("data/samples/historias.docx", await zip.generateAsync({ type: "nodebuffer" }));

// PDF vía Chromium
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent("<h1>Criterios de aceptación</h1><p>CA-1: El login rechaza contraseñas vacías con un mensaje visible.</p><p>CA-2: El carrito conserva los productos al recargar la página.</p>");
await p.pdf({ path: "data/samples/criterios.pdf" });
await b.close();
console.log(fs.readdirSync("data/samples").join(", "));
