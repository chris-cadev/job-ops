/**
 * Output formatting helpers for the CLI.
 */

/**
 * Format a value for display. If it's an object, pretty-print as JSON.
 * If it's null/undefined, show a dash.
 */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  return JSON.stringify(v);
}

/**
 * Print data as formatted JSON to stdout.
 */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Print data as a human-readable table.
 */
export function printTable(
  rows: Record<string, unknown>[],
  columns?: string[],
): void {
  if (rows.length === 0) {
    console.log("(no results)");
    return;
  }

  const keys = columns ?? Object.keys(rows[0]!);
  const colWidths = keys.map((key) =>
    Math.max(
      key.length,
      ...rows.map((r) => String(formatValue(r[key])).length),
    ),
  );

  // Header
  const header = keys.map((key, i) => key.padEnd(colWidths[i]!)).join("  ");
  console.log(header);
  console.log("-".repeat(header.length));

  // Rows
  for (const row of rows) {
    const line = keys
      .map((key, i) => String(formatValue(row[key])).padEnd(colWidths[i]!))
      .join("  ");
    console.log(line);
  }
}

/**
 * Print a single result object.
 */
export function printResult(
  data: unknown,
  format: "json" | "table" = "json",
): void {
  if (format === "json") {
    printJson(data);
    return;
  }
  if (Array.isArray(data)) {
    printTable(data);
  } else if (data && typeof data === "object") {
    printTable([data as Record<string, unknown>]);
  } else {
    console.log(formatValue(data));
  }
}

/**
 * Print a success message.
 */
export function printSuccess(message: string): void {
  console.log(`✓ ${message}`);
}

/**
 * Print an error message to stderr.
 */
export function printError(message: string): void {
  console.error(`✖ ${message}`);
}
