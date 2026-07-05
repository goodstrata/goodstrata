/**
 * Minimal RFC-4180-ish CSV parser (quoted fields, embedded commas/quotes/
 * newlines). Returns rows of trimmed cells; skips fully-empty lines.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  const pushCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    switch (ch) {
      case '"':
        inQuotes = true;
        i += 1;
        break;
      case ",":
        pushCell();
        i += 1;
        break;
      case "\r":
        i += 1;
        break;
      case "\n":
        pushRow();
        i += 1;
        break;
      default:
        cell += ch;
        i += 1;
    }
  }
  if (cell !== "" || row.length > 0) pushRow();
  return rows;
}

/** Parse a CSV with a header row into records keyed by lowercased header. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return [];
  const keys = header.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    keys.forEach((key, idx) => {
      record[key] = cells[idx] ?? "";
    });
    return record;
  });
}
