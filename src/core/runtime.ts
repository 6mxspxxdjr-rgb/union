import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { stableId } from "./id"
import { AdapterRegistry } from "./adapters"
import { CommandRegistry } from "./commands"
import { UnionEvents } from "./events"
import { ICM } from "./icm"
import type { Endpoint, FileRecord } from "./types"
import { ChatGPTAdapter } from "../adapters/chatgpt"
import { BridgeServer } from "../services/bridge-server"
import { UnionDatabase } from "../services/database"
import { FileIndexer } from "../services/file-indexer"
import { readPrefix } from "./fs"

export class UnionRuntime {
  readonly db: UnionDatabase
  readonly events: UnionEvents
  readonly icm: ICM
  readonly bridge: BridgeServer
  readonly adapters = new AdapterRegistry()
  readonly commands = new CommandRegistry()
  readonly indexer: FileIndexer
  private threadState = new Map<string, { generating: boolean; lastAssistant: string }>()

  constructor(public readonly root: string, stateDir = join(homedir(), ".union")) {
    // Each indexed root gets its own durable workspace database. This prevents
    // files and subjects from one project leaking into another workspace.
    const workspaceKey = createHash("sha1").update(root).digest("hex").slice(0, 16)
    this.db = new UnionDatabase(join(stateDir, "workspaces", `${workspaceKey}.db`))
    this.events = new UnionEvents(this.db)
    this.icm = new ICM(this.db, root)
    this.bridge = new BridgeServer(Number(process.env.UNION_BRIDGE_PORT ?? 7331))
    this.indexer = new FileIndexer(root, this.db, this.icm, this.events)
    this.adapters.register(new ChatGPTAdapter(this.bridge))

    this.commands
      .register({ name: "rescan", aliases: ["scan"], title: "Rescan Files", description: "Re-index the current workspace", run: async (_, ctx) => { await ctx.rescan(); ctx.notify("Workspace re-indexed") } })
      .register({ name: "subjects", title: "Subject Lens", description: "Show semantic subject organization", run: (_, ctx) => ctx.setLens("subjects") })
      .register({ name: "files", title: "File Lens", description: "Show the physical file view", run: (_, ctx) => ctx.setLens("files") })
      .register({ name: "agents", aliases: ["systems"], title: "AI Systems Lens", description: "Show connected AI endpoints", run: (_, ctx) => ctx.setLens("agents") })
      .register({ name: "activity", title: "Activity Lens", description: "Show recent Union events", run: (_, ctx) => ctx.setLens("activity") })
  }

  async start() {
    this.bridge.start()
    this.bridge.onEndpoint((raw) => {
      const endpoint = this.icm.normalizeEndpoint({ ...raw, adapterId: "chatgpt-browser" })
      const previous = this.db.listEndpoints().find((item) => item.id === endpoint.id)
      this.db.upsertEndpoint(endpoint)
      if (!previous || previous.status === "offline") {
        this.events.emit("endpoint.connected", { system: endpoint.system, title: endpoint.title, status: endpoint.status }, { objectId: endpoint.id, subject: endpoint.subject })
      } else if (previous.status !== endpoint.status || previous.title !== endpoint.title || previous.subject !== endpoint.subject) {
        this.events.emit("endpoint.status", { system: endpoint.system, title: endpoint.title, status: endpoint.status }, { objectId: endpoint.id, subject: endpoint.subject })
      }
    })

    this.bridge.onThread(({ endpointId, snapshot }) => {
      const endpoint = this.db.listEndpoints().find((item) => item.id === endpointId)
      if (!endpoint) return

      const now = Date.now()
      for (const message of snapshot.messages ?? []) {
        this.db.addMessage({
          id: stableId("msg", `${endpointId}:${message.index}:${message.role}`),
          endpointId,
          role: message.role,
          content: message.content,
          createdAt: now + message.index,
          metadata: { threadIndex: message.index, pushed: true },
        })
      }

      const latestAssistant = [...(snapshot.messages ?? [])].reverse().find((message) => message.role === "assistant")?.content ?? ""
      const nextState = {
        generating: Boolean(snapshot.generating),
        lastAssistant: latestAssistant,
      }
      const previousState = this.threadState.get(endpointId)

      const completedGeneration =
        Boolean(previousState?.generating) &&
        !nextState.generating &&
        Boolean(nextState.lastAssistant)

      const completedWithoutStreaming =
        Boolean(previousState) &&
        !previousState.generating &&
        !nextState.generating &&
        previousState.lastAssistant !== nextState.lastAssistant &&
        Boolean(nextState.lastAssistant)

      this.threadState.set(endpointId, nextState)

      if (completedGeneration || completedWithoutStreaming) {
        this.events.emit(
          "message.received",
          { role: "assistant", chars: nextState.lastAssistant.length, source: "push" },
          { objectId: endpointId, subject: endpoint.subject },
        )
      }
    })

    await this.indexer.watch()

    // Never block the terminal on a full workspace scan. The indexer yields
    // between chunks so keyboard input and rendering stay responsive.
    void this.indexer.scan().catch((error) => {
      this.events.emit("system", { action: "scan.failed", error: String(error), root: this.root })
    })
  }

  subjects() {
    const files = this.db.listFiles()
    const endpoints = this.db.listEndpoints()
    const names = new Set<string>([...files.map((f) => f.subject), ...endpoints.map((e) => e.subject).filter(Boolean) as string[]])
    return [...names].sort((a, b) => a.localeCompare(b)).map((title) => ({
      title,
      files: files.filter((f) => f.subject === title).length,
      active: endpoints.filter((e) => e.subject === title && ["working", "needs_you", "waiting"].includes(e.status)).length,
    }))
  }

  files(subject?: string) {
    return subject ? this.db.filesForSubject(subject) : this.db.listFiles()
  }

  endpoints(subject?: string) {
    return this.db.listEndpoints().filter((endpoint) => !subject || endpoint.subject === subject)
  }

  preview(file?: FileRecord, max = 3500) {
    if (!file) return ""
    try {
      if (file.size > 1024 * 1024) return `${file.summary}\n\nPreview disabled for files over 1 MB.`
      const sample = readPrefix(file.path, max)
      if (sample.includes(0)) return `${file.summary}\n\nBinary file.`
      return sample.toString("utf8")
    } catch (error) {
      return `Unable to read ${file.path}: ${String(error)}`
    }
  }

  async rescan() {
    return this.indexer.scan()
  }

  onThreadUpdate(handler: () => void) {
    return this.bridge.onThread(() => handler())
  }

  async refreshEndpoints() {
    for (const endpoint of await this.adapters.discoverAll()) this.db.upsertEndpoint(this.icm.normalizeEndpoint(endpoint))
  }

  async syncThread(endpoint: Endpoint) {
    const messages = await this.adapters.read(endpoint)
    for (const message of messages) this.db.addMessage(message)
    return messages
  }

  async readLatest(endpoint: Endpoint) {
    const messages = await this.syncThread(endpoint)
    const latest = [...messages].reverse().find((message) => message.role === "assistant")
    if (latest) {
      this.events.emit("message.received", { role: latest.role, chars: latest.content.length }, { objectId: endpoint.id, subject: endpoint.subject })
      return [latest]
    }
    return []
  }

  async send(endpoint: Endpoint, content: string, submit = false) {
    await this.adapters.send(endpoint, content, submit)
    this.events.emit("message.sent", { chars: content.length, submit }, { objectId: endpoint.id, subject: endpoint.subject })
    if (submit) {
      await new Promise((resolve) => setTimeout(resolve, 180))
      await this.syncThread(endpoint).catch(() => {})
    }
  }

  revealFile(file: FileRecord) {
    const command = process.platform === "darwin"
      ? ["open", "-R", file.path]
      : process.platform === "win32"
        ? ["explorer", "/select,", file.path]
        : ["xdg-open", dirname(file.path)]
    Bun.spawn(command, { stdout: "ignore", stderr: "ignore" })
  }

  openEndpoint(endpoint: Endpoint) {
    if (!endpoint.url) return
    const command = process.platform === "darwin"
      ? ["open", endpoint.url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", endpoint.url]
        : ["xdg-open", endpoint.url]
    Bun.spawn(command, { stdout: "ignore", stderr: "ignore" })
  }

  async close() {
    await this.indexer.close()
    await this.adapters.dispose()
    await this.bridge.close()
    this.db.close()
  }
}

export function resolveRoot(input?: string) {
  return resolve(input || process.env.UNION_ROOT || process.cwd())
}
