import crypto from "node:crypto";
import { config } from "../config.js";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encryptionSecret(): string {
  return config.AI_ENCRYPTION_SECRET || config.JWT_SECRET;
}

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(encryptionSecret()), iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length <= IV_LENGTH + TAG_LENGTH) {
    return "";
  }
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(encryptionSecret()), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
