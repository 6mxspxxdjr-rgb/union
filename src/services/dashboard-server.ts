import { fileURLToPath } from "node:url"
import type { Endpoint } from "../core/types"
import type { RoomTurn, UnionRuntime } from "../core/runtime"

export type DashboardRoomStatus = "idle" | "running" | "complete" | "failed" | "stopped"

export type DashboardRoom = {
  id: string
  firstEndpointId: string
  secondEndpointId: string
  task: string
  turns: number
  currentTurn: number
  status: DashboardRoomStatus
  transcript: RoomTurn[]
  error?: string
  createdAt: number
  updatedAt: number
}

const dashboardPath = fileURLToPath(new URL("../../dashboard/index.html", import.meta.url))

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json; charset=utf-8")
  headers.set("cache-control", "no-store")
  return new Response(JSON.stringify(data), { ...init, headers })
}

function badRequest(message: string, status = 400) {
  return json({ error: message }, { status })
}

async function bodyJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>
  } catch {
    return {} as Record<string, unknown>
  }
}

export class DashboardServer {
  private server?: ReturnType<typeof Bun.serve>
  private rooms = new Map<string, DashboardRoom>()
  private roomControllers = new Map<string, AbortController>()

  constructor(
    private runtime: UnionRuntime,
    public readonly port = Number(process.env.UNION_DASHBOARD_PORT ?? 7332),
  ) {}

  start() {
    if (this.server) return
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: this.port,
      fetch: (request) => this.handle(request),
    })
  }

  private snapshot(room: DashboardRoom) {
    return {
      ...room,
      transcript: [...room.transcript],
    }
  }

  private endpoint(id: string) {
    return this.runtime.endpoints().find((endpoint) => endpoint.id === id)
  }

  private activeConflict(room: DashboardRoom) {
    const requested = new Set([room.firstEndpointId, room.secondEndpointId])
    return [...this.rooms.values()].find((candidate) => {
      if (candidate.id === room.id || candidate.status !== "running") return false
      return requested.has(candidate.firstEndpointId) || requested.has(candidate.secondEndpointId)
    })
  }

  private assertRunnableEndpoint(endpoint: Endpoint | undefined, label: string) {
    if (!endpoint) throw new Error(`${label} endpoint no longer exists`)
    if (endpoint.status === "offline") throw new Error(`${label} endpoint is offline`)
    return endpoint
  }

  private async runRoom(room: DashboardRoom, task: string, turns: number) {
    const first = this.assertRunnableEndpoint(this.endpoint(room.firstEndpointId), "First")
    const second = this.assertRunnableEndpoint(this.endpoint(room.secondEndpointId), "Second")
    const conflict = this.activeConflict(room)
    if (conflict) throw new Error("One of these sessions is already being used by another running room")

    const controller = new AbortController()
    this.roomControllers.set(room.id, controller)

    room.task = task
    room.turns = Math.max(2, Math.min(turns, 12))
    room.currentTurn = 0
    room.transcript = []
    room.error = undefined
    room.status = "running"
    room.updatedAt = Date.now()

    void this.runtime.runTwoAgentRoom(task, first, second, {
      turns: room.turns,
      signal: controller.signal,
      onTurn: (turn) => {
        room.transcript.push(turn)
        room.currentTurn = turn.index
        room.updatedAt = Date.now()
      },
    }).then(() => {
      if (controller.signal.aborted) return
      room.status = "complete"
      room.currentTurn = room.turns
      room.updatedAt = Date.now()
    }).catch((error) => {
      if (controller.signal.aborted) {
        room.status = "stopped"
        room.error = undefined
      } else {
        room.status = "failed"
        room.error = error instanceof Error ? error.message : String(error)
      }
      room.updatedAt = Date.now()
    }).finally(() => {
      this.roomControllers.delete(room.id)
    })
  }

  private async handle(request: Request) {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === "GET" && path === "/") {
      return new Response(Bun.file(dashboardPath), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      })
    }

    if (request.method === "GET" && path === "/favicon.ico") return new Response(null, { status: 204 })

    if (request.method === "GET" && path === "/api/health") {
      return json({ ok: true, bridgePort: this.runtime.bridge.port, dashboardPort: this.port })
    }

    if (request.method === "GET" && path === "/api/endpoints") {
      await this.runtime.refreshEndpoints().catch(() => {})
      const endpoints = this.runtime.endpoints().sort((a, b) => {
        const offlineDelta = Number(a.status === "offline") - Number(b.status === "offline")
        if (offlineDelta) return offlineDelta
        const systemDelta = a.system.localeCompare(b.system)
        return systemDelta || a.title.localeCompare(b.title)
      })
      return json({ endpoints })
    }

    if (request.method === "GET" && path === "/api/rooms") {
      return json({ rooms: [...this.rooms.values()].map((room) => this.snapshot(room)) })
    }

    if (request.method === "POST" && path === "/api/rooms") {
      const body = await bodyJson(request)
      const firstEndpointId = String(body.firstEndpointId ?? "")
      const secondEndpointId = String(body.secondEndpointId ?? "")
      if (!firstEndpointId || !secondEndpointId) return badRequest("Two endpoint ids are required")
      if (firstEndpointId === secondEndpointId) return badRequest("Connect two different sessions")
      if (!this.endpoint(firstEndpointId) || !this.endpoint(secondEndpointId)) return badRequest("One or both endpoints are unavailable", 404)

      const existing = [...this.rooms.values()].find((room) =>
        room.firstEndpointId === firstEndpointId && room.secondEndpointId === secondEndpointId,
      )
      if (existing) return json({ room: this.snapshot(existing) })

      const now = Date.now()
      const room: DashboardRoom = {
        id: `room_${crypto.randomUUID()}`,
        firstEndpointId,
        secondEndpointId,
        task: "",
        turns: 4,
        currentTurn: 0,
        status: "idle",
        transcript: [],
        createdAt: now,
        updatedAt: now,
      }
      this.rooms.set(room.id, room)
      return json({ room: this.snapshot(room) }, { status: 201 })
    }

    const roomMatch = path.match(/^\/api\/rooms\/([^/]+)$/)
    if (roomMatch && request.method === "GET") {
      const room = this.rooms.get(roomMatch[1])
      return room ? json({ room: this.snapshot(room) }) : badRequest("Room not found", 404)
    }

    if (roomMatch && request.method === "DELETE") {
      const room = this.rooms.get(roomMatch[1])
      if (!room) return badRequest("Room not found", 404)
      this.roomControllers.get(room.id)?.abort()
      this.roomControllers.delete(room.id)
      this.rooms.delete(room.id)
      return json({ ok: true })
    }

    const runMatch = path.match(/^\/api\/rooms\/([^/]+)\/run$/)
    if (runMatch && request.method === "POST") {
      const room = this.rooms.get(runMatch[1])
      if (!room) return badRequest("Room not found", 404)
      if (room.status === "running") return badRequest("Room is already running", 409)
      const body = await bodyJson(request)
      const task = String(body.task ?? room.task).trim()
      const turns = Number(body.turns ?? room.turns)
      if (!task) return badRequest("Give the room a task before running it")
      if (!Number.isFinite(turns)) return badRequest("Turns must be a number")

      try {
        await this.runRoom(room, task, turns)
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : String(error), 409)
      }
      return json({ room: this.snapshot(room) }, { status: 202 })
    }

    const stopMatch = path.match(/^\/api\/rooms\/([^/]+)\/stop$/)
    if (stopMatch && request.method === "POST") {
      const room = this.rooms.get(stopMatch[1])
      if (!room) return badRequest("Room not found", 404)
      this.roomControllers.get(room.id)?.abort()
      room.status = "stopped"
      room.updatedAt = Date.now()
      return json({ room: this.snapshot(room) })
    }

    return badRequest("Not found", 404)
  }

  async close() {
    for (const controller of this.roomControllers.values()) controller.abort()
    this.roomControllers.clear()
    if (this.server) await this.server.stop(true)
    this.server = undefined
  }
}
