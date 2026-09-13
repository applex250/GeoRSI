import type { IncomingMessage } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { ROOT } from "../config.js";

export const UPLOAD_ROOT = join(ROOT, "runs", ".uploads");
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const allowed = new Set([".pdf", ".csv", ".xls", ".xlsx", ".tif", ".tiff", ".geojson"]);
export interface ResearchUpload { id: string; name: string; bytes: number; sha256: string; createdAt: string }
export function uploadPath(file: ResearchUpload): string { return join(UPLOAD_ROOT, file.id + extname(file.name).toLowerCase()); }
export function getUpload(id: string): ResearchUpload {
  if (!/^upload_[a-f0-9]{32}$/.test(id)) throw new Error("invalid upload id");
  const file = JSON.parse(readFileSync(join(UPLOAD_ROOT, id + ".json"), "utf8")) as ResearchUpload;
  if (file.id !== id || !allowed.has(extname(file.name).toLowerCase()) || !existsSync(uploadPath(file)) || statSync(uploadPath(file)).size !== file.bytes) throw new Error("upload is unavailable");
  return file;
}
export async function receiveUpload(req: IncomingMessage, name: string): Promise<ResearchUpload> {
  name = basename(name.replaceAll("\\", "/")).normalize("NFC");
  if (!name || name.length > 180 || /[\x00-\x1f]/.test(name) || !allowed.has(extname(name).toLowerCase())) throw new Error("unsupported file type or filename");
  if (Number(req.headers["content-length"]) > MAX_UPLOAD_BYTES) throw new Error("file exceeds 100 MB");
  mkdirSync(UPLOAD_ROOT, { recursive: true });
  const file: ResearchUpload = { id: "upload_" + randomUUID().replaceAll("-", ""), name, bytes: 0, sha256: "", createdAt: new Date().toISOString() };
  const target = uploadPath(file);
  const handle = await open(target, "wx", 0o600);
  const hash = createHash("sha256");
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.from(chunk);
      file.bytes += bytes.length;
      if (file.bytes > MAX_UPLOAD_BYTES) throw new Error("file exceeds 100 MB");
      hash.update(bytes);
      await handle.writeFile(bytes);
    }
    if (!file.bytes) throw new Error("file is empty");
    file.sha256 = hash.digest("hex");
    await handle.close();
    writeFileSync(join(UPLOAD_ROOT, file.id + ".json"), JSON.stringify(file), { flag: "wx", mode: 0o600 });
    return file;
  } catch (error) {
    await handle.close().catch(() => {}); await unlink(target).catch(() => {});
    req.resume(); throw error;
  }
}
