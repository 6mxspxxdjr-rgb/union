import { EventEmitter } from "node:events"
import { WebSocketServer, WebSocket } from "ws"
import type { Endpoint } from "../core/types"

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }

type ClientState = {
  socket: WebSocket
  endpoints: Map<string, Endpoint>
}

export class BridgeServer {
  private server?: WebSocketServer
  private clients = new Set<ClientState>()
  private endpointSockets = new Map<string, WebSocket>()
  private endpoints = new Map<string, Endpoint>()
  private pending = new Map<string, Pending>()
  private events = new EventEmitter()

  constructor(public readonly port = 7331) {}

  start() {
    if (this.server) return
    this.server = new WebSocketServer({ host: "127.0.0.1", port: this.port })
    this.server.on("connection", (socket) => {
      const state: ClientState = { socket, endpoints: new Map() }
      this.clients.add(state)

      socket.on("message", (raw) => {
        let message: any
        try { message = JSON.parse(String(raw)) } catch { return }
        if (message.type === "endpoint.upsert" && message.endpoint?.id) {
          const endpoint = message.endpoint as Endpoint
          endpoint.updatedAt = Date.now()
          state.endpoints.set(endpoint.id, endpoint)
          this.endpoints.set(endpoint.id, endpoint)
          this.endpointSockets.set(endpoint.id, socket)
          this.events.emit("endpoint", endpoint)
          return
        }
        if (message.type === "response" && message.requestId) {
          const pending = this.pending.get(message.requestId)
          if (!pending) return
          clearTimeout(pending.timeout)
          this.pending.delete(message.requestId)
          message.ok === false ? pending.reject(new Error(message.error || "Bridge request failed")) : pending.resolve(message.data)
          return
        }
        if (message.type === "endpoint.status" && message.endpointId) {
          const endpoint = this.endpoints.get(message.endpointId)
          if (endpoint) {
            endpoint.status = message.status
            endpoint.updatedAt = Date.now()
            this.events.emit("endpoint", endpoint)
          }
        }
      })

      socket.on("close", () => {
        this.clients.delete(state)
        for (const endpoint of state.endpoints.values()) {
          this.endpointSockets.delete(endpoint.id)
          const current = this.endpoints.get(endpoint.id)
          if (current) {
            current.status = "offline"
            current.updatedAt = Date.now()
            this.events.emit("endpoint", current)
          }
        }
      })
    })
  }

  list(provider?: string) {
    const all = [...this.endpoints.values()]
    return provider ? all.filter((endpoint) => endpoint.system.toLowerCase() === provider.toLowerCase()) : all
  }

  onEndpoint(handler: (endpoint: Endpoint) => void) {
    this.events.on("endpoint", handler)
    return () => this.events.off("endpoint", handler)
  }

  request<T = unknown>(endpointId: string, action: string, payload: Record<string, unknown> = {}, timeoutMs = 7000): Promise<T> {
    const socket = this.endpointSockets.get(endpointId)
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`Endpoint is not connected: ${endpointId}`))
    const requestId = crypto.randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Bridge request timed out: ${action}`))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timeout })
      socket.send(JSON.stringify({ type: "request", requestId, endpointId, action, payload }))
    })
  }

  async close() {
    for (const client of this.clients) client.socket.close()
    await new Promise<void>((resolve) => this.server?.close(() => resolve()))
    this.server = undefined
  }
}
