import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import { extname, resolve } from "node:path"
import { WebSocketServer, WebSocket } from "ws"
import type { UnionRuntime } from "../core/runtime"
import type { WorkflowEngine } from "../core/workflow-engine"
import type { WorkflowDefinition } from "../core/workflow"

type DashboardMessage = {
  type: string
  data?: unknown
}

export class DashboardServer {
  private server?: ReturnType<typeof createServer>
  private sockets = new Set<WebSocket>()
  private ws?: WebSocketServer
  private offEvent?: () => void
  private stateTimer?: ReturnType<typeof setInterval>
  private readonly webRoot = resolve(import.meta.dir, "../../web")

  constructor(
    private runtime: UnionRuntime,
    private engine: WorkflowEngine,
    public readonly port = 7332,
  ) {}

  async start() {
    if (this.server) return
    this.server = createServer((req, res) => void this.handle(req, res))

    this.ws = new WebSocketServer({ noServer: true })
    this.server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/ws") {
        socket.destroy()
        return
      }

      this.ws?.handleUpgrade(request, socket, head, (client) => {
        this.sockets.add(client)
        client.on("close", () => this.sockets.delete(client))
        client.send(JSON.stringify({ type: "state", data: this.state() }))
      })
    })

    this.offEvent = this.runtime.events.on((event) => {
      this.broadcast({ type: "event", data: event })
    })

    this.stateTimer = setInterval(() => {
      this.broadcast({ type: "state", data: this.state() })
    }, 1500)

    await new Promise<void>((resolvePromise, reject) => {
      this.server!.once("error", reject)
      this.server!.listen(this.port, "127.0.0.1", () => resolvePromise())
    })

    this.runtime.events.emit(
      "system",
      {
        action: "dashboard.started",
        url: `http://127.0.0.1:${this.port}`,
      },
      { subject: "Workflows" },
    )
  }

  private state() {
    return {
      endpoints: this.runtime.endpoints().map((endpoint) => ({
        id: endpoint.id,
        system: endpoint.system,
        title: endpoint.title,
        status: endpoint.status,
        url: endpoint.url,
      })),
      runs: this.engine.listRuns().slice(0, 20).map((run) => ({
        id: run.id,
        workflowId: run.workflowId,
        workflowName: run.workflowName,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        currentModuleId: run.currentModuleId,
        currentNodeId: run.currentNodeId,
        currentCycle: run.currentCycle,
        currentTurn: run.currentTurn,
        stateVersion: run.packet.stateVersion,
        chars: run.packet.payload.length,
        error: run.error,
      })),
      events: this.runtime.db.recentEvents(40),
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`)
    try {
      if (url.pathname === "/api/health") {
        return this.json(res, 200, { ok: true, port: this.port })
      }

      if (url.pathname === "/api/state" && req.method === "GET") {
        return this.json(res, 200, this.state())
      }

      if (url.pathname === "/api/run" && req.method === "POST") {
        const body = await this.body(req)
        const workflow = body.workflow as WorkflowDefinition | undefined
        const input = String(body.input || "").trim()
        if (!workflow) return this.json(res, 400, { error: "workflow is required" })
        if (!input) return this.json(res, 400, { error: "input is required" })

        const run = this.engine.start(workflow, input)
        return this.json(res, 202, {
          id: run.id,
          status: run.status,
          workflowId: run.workflowId,
        })
      }

      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
      if (runMatch && req.method === "GET") {
        const run = this.engine.getRun(runMatch[1])
        return run
          ? this.json(res, 200, run)
          : this.json(res, 404, { error: "run not found" })
      }

      const stopMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/stop$/)
      if (stopMatch && req.method === "POST") {
        const stopped = this.engine.stop(stopMatch[1])
        return this.json(res, stopped ? 200 : 404, { stopped })
      }

      if (req.method === "GET") return this.staticFile(url.pathname, res)
      return this.json(res, 405, { error: "method not allowed" })
    } catch (error) {
      return this.json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private staticFile(pathname: string, res: ServerResponse) {
    const relative =
      pathname === "/"
        ? "index.html"
        : pathname === "/app.js"
          ? "app.js"
          : pathname === "/styles.css"
            ? "styles.css"
            : ""

    if (!relative) return this.json(res, 404, { error: "not found" })
    const path = resolve(this.webRoot, relative)
    if (!path.startsWith(this.webRoot) || !existsSync(path)) {
      return this.json(res, 404, { error: "not found" })
    }

    const type = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
    }[extname(path)] || "application/octet-stream"

    res.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store",
    })
    res.end(readFileSync(path))
  }

  private json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    })
    res.end(JSON.stringify(value))
  }

  private body(req: IncomingMessage) {
    return new Promise<Record<string, unknown>>((resolvePromise, reject) => {
      let raw = ""
      req.setEncoding("utf8")
      req.on("data", (chunk) => {
        raw += chunk
        if (raw.length > 2_000_000) {
          reject(new Error("Request body too large"))
          req.destroy()
        }
      })
      req.on("end", () => {
        try {
          resolvePromise(raw ? JSON.parse(raw) : {})
        } catch {
          reject(new Error("Invalid JSON body"))
        }
      })
      req.on("error", reject)
    })
  }

  private broadcast(message: DashboardMessage) {
    const payload = JSON.stringify(message)
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload)
    }
  }

  async close() {
    this.offEvent?.()
    if (this.stateTimer) clearInterval(this.stateTimer)
    for (const socket of this.sockets) socket.close()
    this.sockets.clear()
    this.ws?.close()

    if (!this.server) return
    await new Promise<void>((resolvePromise) => this.server?.close(() => resolvePromise()))
    this.server = undefined
  }
}
