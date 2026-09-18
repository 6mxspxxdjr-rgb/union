import { createHash, randomUUID } from "node:crypto"

export function stableId(namespace: string, value: string) {
  return `${namespace}_${createHash("sha1").update(value).digest("hex").slice(0, 16)}`
}

export function id(prefix: string) {
  return `${prefix}_${randomUUID()}`
}
