/**
 * Durable write helpers — fsync before rename where possible.
 */
import fs from "node:fs/promises";
import path from "node:path";

export async function durableWriteJson(fp, data) {
  const dir = path.dirname(fp);
  await fs.mkdir(dir, { recursive: true });
  const tmp = fp + ".tmp";
  const payload = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(payload, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, fp);
  try {
    const dh = await fs.open(dir, "r");
    try {
      await dh.sync();
    } finally {
      await dh.close();
    }
  } catch {
    /* directory fsync not always supported */
  }
  return fp;
}

export async function durableAppendLine(fp, line) {
  const dir = path.dirname(fp);
  await fs.mkdir(dir, { recursive: true });
  const fh = await fs.open(fp, "a");
  try {
    await fh.writeFile(line.endsWith("\n") ? line : line + "\n", "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  return fp;
}

export default { durableWriteJson, durableAppendLine };
