/** CSV local: preserva texto y neutraliza fórmulas de hojas de cálculo. */
export function csvDocument(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  const cell = (value: unknown) => {
    let text =
      typeof value === 'string'
        ? value
        : typeof value === 'number'
          ? String(value)
          : '';
    if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return (
    '\uFEFF' +
    [
      columns.map(cell).join(','),
      ...rows.map((row) => columns.map((key) => cell(row[key])).join(',')),
    ].join('\r\n') +
    '\r\n'
  );
}
