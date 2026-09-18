import { closeSync, openSync, readSync } from "node:fs"

export function readPrefix(path: string, maxBytes: number) {
  const fd = openSync(path, "r")
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    closeSync(fd)
  }
}

export function readUtf8Prefix(path: string, maxBytes: number) {
  const buffer = readPrefix(path, maxBytes)
  if (buffer.includes(0)) return undefined
  return buffer.toString("utf8")
}
