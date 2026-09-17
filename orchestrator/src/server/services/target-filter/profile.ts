import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDataDir } from "@server/config/dataDir";

const DEFAULT_FILENAME = "TARGET_PROFILE.md";
const DATA_FILENAME = "target-profile.md";

function repoDefaultPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), DEFAULT_FILENAME);
}

/**
 * Resuelve qué markdown de perfil usar:
 * 1. `TARGET_PROFILE_PATH` si apunta a un archivo existente.
 * 2. `<DATA_DIR>/target-profile.md` (persistido en volumen, editable).
 * 3. Default del repo junto a este módulo.
 */
export function resolveTargetProfilePath(): string {
  const fromEnv = (process.env.TARGET_PROFILE_PATH ?? "").trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const inData = join(getDataDir(), DATA_FILENAME);
  if (existsSync(inData)) return inData;
  return repoDefaultPath();
}

export async function loadTargetProfile(): Promise<{
  text: string;
  source: string;
}> {
  const source = resolveTargetProfilePath();
  const text = await readFile(source, "utf-8");
  return { text, source };
}
