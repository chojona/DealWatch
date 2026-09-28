function escapePdfString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Builds a tiny text-based PDF with one content stream per page.
 * Used by tests and the single smoke run. Not a general PDF writer.
 */
export function buildTextPdf(pages: string[]): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [0];

  function add(body: string) {
    offsets.push(Buffer.concat(parts).length);
    parts.push(Buffer.from(body));
  }

  const pageObjectIds: number[] = [];
  const contentIds: number[] = [];
  let nextId = 4;
  for (let index = 0; index < pages.length; index += 1) {
    pageObjectIds.push(nextId);
    nextId += 1;
    contentIds.push(nextId);
    nextId += 1;
  }

  add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
  add(
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`
  );
  add(
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  );

  pages.forEach((page, index) => {
    const lines = page.split("\n");
    const commands = ["BT", "/F1 12 Tf", "72 720 Td"];
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) commands.push("0 -16 Td");
      commands.push(`(${escapePdfString(line)}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    const pageId = pageObjectIds[index]!;
    const contentId = contentIds[index]!;
    add(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`
    );
    add(
      `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`
    );
  });

  const xrefOffset = Buffer.concat(parts).length;
  const size = offsets.length;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}
