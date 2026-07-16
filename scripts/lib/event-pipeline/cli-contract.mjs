export function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else { options[key] = next; index += 1; }
  }
  return { command, options };
}

export function parseManifest(markdown) {
  const timezone = markdown.match(/- Timezone:\s*`([^`]+)`/)?.[1];
  if (timezone !== "Asia/Singapore") throw new Error("pull_data.md must declare timezone Asia/Singapore");
  const sources = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|") || line.includes("---") || line.includes("| Source |")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replaceAll("`", ""));
    if (cells.length >= 5 && cells[1].toLowerCase() === "yes") sources.push({ name: cells[0], adapterId: cells[2], version: "1.0" });
  }
  if (!sources.length) throw new Error("pull_data.md contains no enabled sources");
  return { timezone, sources };
}

export function singaporeWindowForDays(dateText, daysAfterStart, { now = new Date() } = {}) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" });
  const current = dateText ?? formatter.format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(current)) throw new Error("--date must use YYYY-MM-DD");
  const start = new Date(`${current}T00:00:00+08:00`);
  if (Number.isNaN(start.valueOf())) throw new Error(`Invalid date: ${current}`);
  const end = new Date(start.valueOf() + daysAfterStart * 86_400_000);
  const isoDate = (value) => formatter.format(value);
  return { start: `${isoDate(start)}T00:00:00+08:00`, end: `${isoDate(end)}T23:59:59+08:00`, inclusive: true };
}
