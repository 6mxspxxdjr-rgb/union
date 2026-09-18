import { basename, dirname, extname, relative, sep } from "node:path"
import type { ContextItem, ContextPack, Endpoint, FileRecord } from "./types"
import type { UnionDatabase } from "../services/database"
import { isSensitivePath } from "./security"
import { readUtf8Prefix } from "./fs"

const STOP = new Set(["the","a","an","and","or","for","of","to","in","on","with","src","source","index","main","new","final","copy"])

function words(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
}

function titleCase(input: string) {
  return words(input).filter((w) => !STOP.has(w.toLowerCase())).slice(0, 6).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ") || "Untitled"
}

export class ICM {
  constructor(private db: UnionDatabase, private root: string) {}

  titleForPath(path: string) {
    const name = basename(path, extname(path))
    try {
      if ([".md", ".mdx", ".txt"].includes(extname(path).toLowerCase())) {
        const first = readUtf8Prefix(path, 4000)?.split("\n").find((line) => /^#\s+/.test(line))
        if (first) return titleCase(first.replace(/^#\s+/, ""))
      }
    } catch {}
    return titleCase(name)
  }

  subjectForPath(path: string) {
    const rel = relative(this.root, path)
    const parts = rel.split(sep).filter(Boolean)
    const text = parts.join(" ").toLowerCase()

    const rules: Array<[RegExp, string]> = [
      [/union|relay|adapter|tui|terminal|context|icm/, "Union"],
      [/youtube|video|shorts|content|thumbnail|prayer|bodybuild/, "Content"],
      [/job|career|resume|application|interview|dsp|employment/, "Employment"],
      [/trade|trading|option|market|spy|qqq|portfolio/, "Trading"],
      [/igc|card|grading/, "IGC"],
      [/finance|budget|invoice|money|cash/, "Finance"],
    ]
    for (const [pattern, subject] of rules) if (pattern.test(text)) return subject

    const directory = parts.length > 1 ? parts[0]! : dirname(rel).split(sep).filter(Boolean).pop()
    if (directory && directory !== ".") return titleCase(directory)
    return "Unsorted"
  }

  summarizeFile(file: FileRecord) {
    const kb = Math.max(0.1, file.size / 1024).toFixed(1)
    return `${file.extension || "file"} · ${kb} KB · ${relative(this.root, file.path)}`
  }

  normalizeEndpoint(endpoint: Endpoint): Endpoint {
    const subject = endpoint.subject || this.subjectFromText(`${endpoint.title} ${endpoint.system}`)
    return { ...endpoint, title: titleCase(endpoint.title), subject }
  }

  subjectFromText(text: string) {
    const value = text.toLowerCase()
    if (/union|relay|adapter|terminal|tui|context|icm/.test(value)) return "Union"
    if (/job|career|resume|interview|dsp/.test(value)) return "Employment"
    if (/youtube|video|content|bodybuild|prayer/.test(value)) return "Content"
    if (/trade|option|market|spy|qqq/.test(value)) return "Trading"
    if (/igc|grading|card/.test(value)) return "IGC"
    return "Unsorted"
  }

  materialize(pack: ContextPack, charBudget = 24000) {
    const chunks: string[] = []
    let used = 0
    const push = (chunk: string) => {
      if (used >= charBudget) return false
      const remaining = charBudget - used
      const value = chunk.length > remaining ? chunk.slice(0, remaining) : chunk
      chunks.push(value)
      used += value.length
      return used < charBudget
    }

    push(`# Union Context Pack\nSubject: ${pack.subject || "Unsorted"}\nGenerated: ${new Date(pack.createdAt).toISOString()}\n`)

    for (const item of pack.items) {
      if (item.kind !== "file" || !item.path || isSensitivePath(item.path)) continue
      let content = ""
      try {
        const text = readUtf8Prefix(item.path, Math.min(charBudget, 64_000))
        if (text === undefined) continue
        content = text
      } catch {
        continue
      }
      const header = `\n## ${item.title}\nPath: ${relative(this.root, item.path)}\nReason: ${item.reason}\n\n`
      if (!push(header)) break
      if (!push(content + "\n")) break
    }

    return chunks.join("")
  }

  compile(focus: { subject?: string; fileId?: string; endpointId?: string }, limit = 12): ContextPack {
    const files = focus.subject ? this.db.filesForSubject(focus.subject, 200) : this.db.listFiles(200)
    const endpoints = this.db.listEndpoints()
    const now = Date.now()
    const items: ContextItem[] = []

    for (const file of files) {
      const ageHours = Math.max(0, (now - file.modifiedAt) / 3_600_000)
      const recency = Math.max(0, 2 - Math.log10(ageHours + 1))
      const focusBoost = file.id === focus.fileId ? 10 : 0
      items.push({
        kind: "file",
        id: file.id,
        title: file.title,
        path: file.path,
        score: 3 + recency + focusBoost,
        reason: focusBoost ? "current file" : focus.subject ? `same subject: ${focus.subject}` : "recent indexed file",
      })
    }

    for (const endpoint of endpoints) {
      if (focus.subject && endpoint.subject !== focus.subject && endpoint.id !== focus.endpointId) continue
      items.push({
        kind: "endpoint",
        id: endpoint.id,
        title: `${endpoint.system}: ${endpoint.title}`,
        score: endpoint.id === focus.endpointId ? 10 : endpoint.status === "working" ? 6 : 3,
        reason: endpoint.id === focus.endpointId ? "current endpoint" : `${endpoint.status} endpoint in subject`,
      })
    }

    items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    const selected = items.slice(0, limit)
    return {
      subject: focus.subject,
      focusId: focus.fileId ?? focus.endpointId,
      items: selected,
      estimatedChars: selected.reduce((sum, item) => sum + (item.content?.length ?? item.title.length + item.reason.length), 0),
      createdAt: now,
    }
  }
}
