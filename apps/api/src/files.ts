import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const maxBytes = 5 * 1024 * 1024;

export function pdfDigest(file: Express.Multer.File | undefined) {
  if (
    !file ||
    file.size > maxBytes ||
    !/\.pdf$/i.test(file.originalname) ||
    !file.buffer
      .subarray(0, 8)
      .toString("ascii")
      .match(/^%PDF-[12]\.[0-9]/) ||
    !file.buffer
      .subarray(-1024)
      .toString("latin1")
      .match(/%%EOF\s*$/)
  ) {
    throw new BadRequestException("Upload a PDF of at most 5 MiB");
  }
  return createHash("sha256").update(file.buffer).digest("hex");
}

export class PrivateFiles {
  private readonly root: string;
  constructor(root: string) {
    if (!root) throw new Error("FILE_STORAGE_ROOT is required");
    this.root = resolve(root);
  }
  private path(id: string) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))
      throw new Error("Invalid storage reference");
    return join(this.root, id + ".pdf");
  }
  async put(id: string, file: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.path(id), file, { flag: "wx", mode: 0o600 });
  }
  get(id: string) {
    return readFile(this.path(id));
  }
}
