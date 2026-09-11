import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Minimal .env reader. The CLI tells the user their key belongs in ".env of this folder", so the CLI has to actually
 * read it. Values already present in the real environment win; a .env never silently overrides an explicit export.
 */
export async function loadDotEnv(dir: string, env: NodeJS.ProcessEnv): Promise<void> {
  let text: string;
  try {
    text = await readFile(join(dir, ".env"), "utf8");
  } catch {
    return; // absent .env is the normal case, not an error
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value !== "" && env[key] === undefined) env[key] = value;
  }
}
