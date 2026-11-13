import { CATEGORY_LABELS, catalog, type Category } from "./core/index.js";

/** Agent-readable catalog. Generated from the registry: never edited by hand. */
export function catalogMarkdown(): string {
  const items = catalog();
  const lines = [
    "# Effect catalog",
    "",
    "<!-- Generated with `pnpm catalog`. Do not edit by hand: the source is src/core/effects. -->",
    "",
    `${items.length} effects. CLI step format: \`effect:param=value,param=value@from-to\`. Effects marked _at a moment_ are anchored with \`at=<seconds>\`.`,
    "",
  ];
  for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
    const group = items.filter((e) => e.category === (cat as Category));
    if (!group.length) continue;
    lines.push(`## ${label}`, "");
    for (const e of group) {
      const flags = [e.timed && "at a moment", e.changesDuration && "changes duration", e.hasTail && "adds tail"].filter(Boolean);
      lines.push(`### \`${e.id}\` — ${e.name}${flags.length ? ` _(${flags.join(", ")})_` : ""}`, "");
      lines.push(e.description, "", `**When:** ${e.whenToUse}`, "");
      if (e.params.length) {
        lines.push("| Param | Default | Range |", "| --- | --- | --- |");
        for (const p of e.params) {
          const range =
            p.type === "number" ? `${p.min}–${p.max}${p.unit ? " " + p.unit : ""}` : p.type === "enum" ? p.options.join(", ") : p.type === "file" ? "a path, or `library:<id>`" : "true, false";
          lines.push(`| \`${p.id}\` ${p.label} | ${p.type === "file" ? "(required)" : p.default} | ${range} |`);
        }
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}
