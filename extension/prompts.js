const cache = new Map();

/**
 * Load a prompt from extension/prompts/<id>.md.
 * Strips YAML frontmatter and returns the body text.
 * Results are cached after first load.
 */
export async function loadPrompt(id) {
  if (cache.has(id)) return cache.get(id);

  const url = chrome.runtime.getURL(`prompts/${id}.md`);
  const raw = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Failed to load prompt "${id}": ${r.status}`);
    return r.text();
  });

  // Strip YAML frontmatter block (--- ... ---)
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

  cache.set(id, body);
  return body;
}
