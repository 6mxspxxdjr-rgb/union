import { basename, extname } from "node:path"

const SENSITIVE_NAMES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials",
  "credentials.json",
  "service-account.json",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
])

const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"])

export function isSensitivePath(path: string) {
  const normalized = path.replaceAll("\\", "/").toLowerCase()
  const name = basename(normalized)
  if (SENSITIVE_NAMES.has(name)) return true
  if (name.startsWith(".env.")) return true
  if (SENSITIVE_EXTENSIONS.has(extname(name))) return true
  if (normalized.includes("/.ssh/")) return true
  if (normalized.endsWith("/.aws/credentials")) return true
  if (normalized.includes("/keychains/")) return true
  return false
}
