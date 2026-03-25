export interface Column {
  key: string;
  header: string;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string;
}

export interface OutputOptions {
  json: boolean;
  noColor: boolean;
  pageInfo?: PageInfo;
}

export function formatOutput(data: any, columns: Column[], options: OutputOptions): void {
  if (options.json) {
    const envelope: Record<string, any> = { data };
    if (options.pageInfo) {
      envelope.pageInfo = options.pageInfo;
    }
    process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
    return;
  }

  // Table mode
  if (!Array.isArray(data)) {
    // Single object: key-value display
    for (const col of columns) {
      if (col.key in data) {
        const label = options.noColor ? col.header : `\x1b[1m${col.header}\x1b[0m`;
        process.stdout.write(`${label}: ${data[col.key]}\n`);
      }
    }
    return;
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const values = data.map((row: any) => String(row[col.key] ?? ""));
    return Math.max(col.header.length, ...values.map((v: string) => v.length));
  });

  // Header
  const headerLine = columns.map((col, i) => {
    const padded = col.header.padEnd(widths[i]!);
    return options.noColor ? padded : `\x1b[1m${padded}\x1b[0m`;
  }).join("  ");
  process.stdout.write(headerLine + "\n");

  // Separator
  const separator = widths.map((w) => "─".repeat(w!)).join("  ");
  process.stdout.write(separator + "\n");

  // Data rows
  for (const row of data) {
    const line = columns.map((col, i) => {
      return String(row[col.key] ?? "").padEnd(widths[i]!);
    }).join("  ");
    process.stdout.write(line + "\n");
  }

  // Pagination hint
  if (options.pageInfo?.hasNextPage) {
    process.stdout.write(`\nMore results available. Use --cursor ${options.pageInfo.endCursor} to see next page.\n`);
  }
}

export function formatError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}
