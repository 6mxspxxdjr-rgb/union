import fg from "fast-glob"
import chokidar, { type FSWatcher } from "chokidar"
import { statSync } from "node:fs"
import { extname, resolve } from "node:path"
import { stableId } from "../core/id"
import { isSensitivePath } from "../core/security"
import type { FileRecord } from "../core/types"
import type { ICM } from "../core/icm"
import type { UnionDatabase } from "./database"
import type { UnionEvents } from "../core/events"

const DEFAULT_IGNORES = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/.cache/**",
  "**/Library/Caches/**",
  "**/Library/Application Support/**",
  "**/.Trash/**",
  "**/.npm/**",
  "**/.bun/**",
  "**/.env",
  "**/.env.*",
  "**/.ssh/**",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
]

const TEXTISH = new Set([
  ".md", ".mdx", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ts", ".tsx", ".js", ".jsx",
  ".py", ".rs", ".go", ".java", ".kt", ".swift", ".html", ".css", ".scss", ".sh", ".zsh", ".fish", ".sql",
  ".csv", ".tsv", ".xml", ".ini", ".env", ".c", ".cpp", ".h", ".hpp",
])

const yieldToTerminal = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export class FileIndexer {
  private watcher?: FSWatcher
  private scanning = false

  constructor(
    public readonly root: string,
    private db: UnionDatabase,
    private icm: ICM,
    private events: UnionEvents,
  ) {}

  private record(path: string): FileRecord | undefined {
    try {
      if (isSensitivePath(path)) return
      const stat = statSync(path)
      if (!stat.isFile()) return
      const extension = extname(path).toLowerCase()
      if (stat.size > 8 * 1024 * 1024 && !TEXTISH.has(extension)) return
      const file: FileRecord = {
        id: stableId("file", path),
        path,
        title: this.icm.titleForPath(path),
        subject: this.icm.subjectForPath(path),
        extension,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        indexedAt: Date.now(),
      }
      file.summary = this.icm.summarizeFile(file)
      return file
    } catch {
      return
    }
  }

  private ingest(path: string, eventType: "file.indexed" | "file.changed", emit = true) {
    const file = this.record(resolve(path))
    if (!file) return
    this.db.upsertFile(file)
    if (emit) this.events.emit(eventType, { path: file.path, title: file.title }, { objectId: file.id, subject: file.subject })
  }

  async scan() {
    if (this.scanning) return 0
    this.scanning = true
    this.events.emit("system", { action: "scan.started", root: this.root })

    try {
      const paths = await fg("**/*", {
        cwd: this.root,
        absolute: true,
        onlyFiles: true,
        dot: true,
        followSymbolicLinks: false,
        unique: true,
        ignore: DEFAULT_IGNORES,
      })

      for (let index = 0; index < paths.length; index++) {
        this.ingest(paths[index]!, "file.indexed", false)

        // Cooperative scanning: give OpenTUI/input a chance to run.
        if ((index + 1) % 50 === 0) await yieldToTerminal()

        if ((index + 1) % 500 === 0) {
          this.events.emit("system", {
            action: "scan.progress",
            indexed: index + 1,
            total: paths.length,
            root: this.root,
          })
        }
      }

      this.events.emit("system", { action: "scan.completed", count: paths.length, root: this.root })
      return paths.length
    } finally {
      this.scanning = false
    }
  }

  async watch() {
    if (this.watcher) return
    this.watcher = chokidar.watch(this.root, {
      ignored: (path) => ["/.git/", "/node_modules/", "/.next/", "/dist/", "/build/", "/.cache/", "/Library/Caches/", "/Library/Application Support/", "/.Trash/", "/.npm/", "/.bun/"].some((part) => path.includes(part)),
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 80 },
    })
    this.watcher.on("add", (path) => this.ingest(path, "file.indexed"))
    this.watcher.on("change", (path) => this.ingest(path, "file.changed"))
  }

  async close() {
    await this.watcher?.close()
  }
}
