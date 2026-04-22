/** Split first YAML document delimited by `---` lines (common Markdown convention). */
export function splitYamlFrontmatter(raw: string): { yaml: string; body: string } | null {
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2 || lines[0].trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return {
        yaml: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
      };
    }
  }
  return null;
}
