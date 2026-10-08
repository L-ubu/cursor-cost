import { c, padEndVisible, visibleLength, modelColor } from "./colors.mjs";

export function formatUsd(n) {
  return `$${n.toFixed(2)}`;
}

export function formatTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function stripModelColor(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

export function printTable(headers, rows, { modelCol = -1 } = {}) {
  const widths = headers.map((h, i) =>
    Math.max(
      visibleLength(h),
      ...rows.map((r) => visibleLength(String(r[i] ?? ""))),
    ),
  );
  const border = c.dim("│");
  const headerLine = headers
    .map((h, i) => ` ${c.bold(c.brightCyan(padEndVisible(h, widths[i])))} `)
    .join(border);
  const sep = widths.map((w) => c.dim("─".repeat(w + 2))).join(c.dim("┼"));
  console.log(headerLine);
  console.log(sep);
  for (const row of rows) {
    const cells = row.map((cell, i) => {
      let s = String(cell ?? "");
      if (i === modelCol) s = modelColor(stripModelColor(s))(s);
      return ` ${padEndVisible(s, widths[i])} `;
    });
    console.log(cells.join(border));
  }
}

export function sectionTitle(text) {
  const line = "─".repeat(Math.max(0, 44 - visibleLength(text)));
  return `\n${c.brightMagenta("╭─")} ${c.bold(c.brightWhite(text))} ${c.brightMagenta(line + "╮")}`;
}
