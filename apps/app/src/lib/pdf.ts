export async function downloadDocument(
  element: HTMLElement,
  filename: string,
  compact = false,
) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  await document.fonts.ready;
  let rowEdges: number[] = [];
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: '#ffffff',
    windowWidth: 1200,
    onclone: (cloned) => {
      const invoice = cloned.querySelector<HTMLElement>('.invoice-document');
      if (invoice !== null) {
        invoice.style.width = '794px';
        invoice.style.maxWidth = 'none';
        invoice.style.margin = '0';
        invoice.style.boxShadow = 'none';
        const top = invoice.getBoundingClientRect().top;
        rowEdges = [
          ...invoice.querySelectorAll(
            'tr, .invoice-footer, .invoice-final, section h2',
          ),
        ].map((node) => node.getBoundingClientRect().top - top);
      }
    },
  });
  const advertising = compact;
  const compactHeight = Math.max(
    100,
    Math.min(297, canvas.height * (186 / canvas.width) + 26),
  );
  const pdf = new jsPDF({
    unit: 'mm',
    orientation: advertising && compactHeight < 210 ? 'landscape' : 'portrait',
    format: advertising ? [210, compactHeight] : 'a4',
    compress: true,
  });
  const width = pdf.internal.pageSize.getWidth() - 24;
  const height = pdf.internal.pageSize.getHeight() - 24;
  const scale = width / canvas.width;
  const capacity = Math.floor(height / scale);
  let offset = 0;
  while (offset < canvas.height) {
    const remaining = canvas.height - offset;
    const target =
      remaining > capacity && remaining < capacity * 1.3
        ? offset + Math.floor(remaining / 2)
        : offset + capacity;
    let end = Math.min(canvas.height, target);
    if (end < canvas.height) {
      const boundary = rowEdges
        .map((edge) => Math.floor(edge * 2))
        .filter((edge) => edge > offset + capacity / 3 && edge <= end)
        .at(-1);
      if (boundary !== undefined) end = boundary;
    }
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = end - offset;
    const drawing = slice.getContext('2d');
    if (drawing === null)
      throw new Error(
        'This browser could not prepare the PDF. Use Print instead.',
      );
    drawing.drawImage(
      canvas,
      0,
      offset,
      canvas.width,
      slice.height,
      0,
      0,
      slice.width,
      slice.height,
    );
    if (offset > 0) pdf.addPage();
    if (offset > 0) {
      pdf.setFontSize(8);
      pdf.text(`${filename} - continued`, 12, 8);
    }
    pdf.addImage(slice, 'PNG', 12, 12, width, slice.height * scale);
    offset = end;
  }
  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    pdf.setPage(page);
    pdf.setFontSize(8);
    pdf.text(
      `Page ${String(page)} / ${String(pageCount)}`,
      pdf.internal.pageSize.getWidth() - 12,
      pdf.internal.pageSize.getHeight() - 6,
      { align: 'right' },
    );
  }
  await pdf.save(`${filename}.pdf`, { returnPromise: true });
}
