export function fixture() {
  let source = "%PDF-1.4\n";
  const content =
    "BT /F1 22 Tf 55 720 Td (MediLedger synthetic report) Tj 0 -42 Td /F1 12 Tf (Demonstration only. No clinical data.) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length " + content.length + " >>\nstream\n" + content + "endstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const offsets = objects.map((object, index) => {
    const offset = source.length;
    source += index + 1 + " 0 obj\n" + object + "\nendobj\n";
    return String(offset).padStart(10, "0") + " 00000 n \n";
  });
  const xref = source.length;
  return Buffer.from(
    source +
      "xref\n0 6\n0000000000 65535 f \n" +
      offsets.join("") +
      "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
      xref +
      "\n%%EOF\n",
  );
}
