import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ICM } from "./icm"
import { UnionDatabase } from "../services/database"
import { stableId } from "./id"
import { isSensitivePath } from "./security"

const cleanup: string[] = []
afterEach(() => {
  while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true })
})

describe("ICM", () => {
  test("derives stable human titles and subjects", () => {
    const root = mkdtempSync(join(tmpdir(), "union-icm-"))
    cleanup.push(root)
    const project = join(root, "union")
    mkdirSync(project)
    const file = join(project, "relay-design.md")
    writeFileSync(file, "# Browser Relay Architecture\n\nAdapter notes")

    const db = new UnionDatabase(join(root, "state.db"))
    const icm = new ICM(db, root)

    expect(icm.titleForPath(file)).toBe("Browser Relay Architecture")
    expect(icm.subjectForPath(file)).toBe("Union")
    db.close()
  })

  test("materializes bounded context from the selected subject", () => {
    const root = mkdtempSync(join(tmpdir(), "union-context-"))
    cleanup.push(root)
    const project = join(root, "union")
    mkdirSync(project)
    const path = join(project, "protocol.md")
    writeFileSync(path, "# Adapter Protocol\n\nCONNECT READ SEND SUBMIT")

    const db = new UnionDatabase(join(root, "state.db"))
    const icm = new ICM(db, root)
    const record = {
      id: stableId("file", path),
      path,
      title: icm.titleForPath(path),
      subject: icm.subjectForPath(path),
      extension: ".md",
      size: 42,
      modifiedAt: Date.now(),
      indexedAt: Date.now(),
      summary: "protocol"
    }
    db.upsertFile(record)

    const pack = icm.compile({ subject: "Union", fileId: record.id })
    const text = icm.materialize(pack, 4000)
    expect(pack.items[0]?.id).toBe(record.id)
    expect(text).toContain("Adapter Protocol")
    expect(text).toContain("CONNECT READ SEND SUBMIT")
    expect(text.length).toBeLessThanOrEqual(4000)
    db.close()
  })
})

describe("sensitive paths", () => {
  test("blocks common credential files", () => {
    expect(isSensitivePath("/Users/me/project/.env")).toBe(true)
    expect(isSensitivePath("/Users/me/.ssh/id_ed25519")).toBe(true)
    expect(isSensitivePath("/Users/me/certs/client.pem")).toBe(true)
    expect(isSensitivePath("/Users/me/project/README.md")).toBe(false)
  })
})
