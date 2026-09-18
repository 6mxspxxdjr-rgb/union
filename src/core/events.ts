import { EventEmitter } from "node:events"
import { id } from "./id"
import type { UnionEvent, UnionEventType } from "./types"
import type { UnionDatabase } from "../services/database"

export class UnionEvents {
  private emitter = new EventEmitter()

  constructor(private db: UnionDatabase) {}

  emit(type: UnionEventType, payload: Record<string, unknown> = {}, meta: { objectId?: string; subject?: string } = {}) {
    const event: UnionEvent = {
      id: id("evt"),
      type,
      objectId: meta.objectId,
      subject: meta.subject,
      payload,
      createdAt: Date.now(),
    }
    this.db.addEvent(event)
    this.emitter.emit("event", event)
    this.emitter.emit(type, event)
    return event
  }

  on(handler: (event: UnionEvent) => void) {
    this.emitter.on("event", handler)
    return () => this.emitter.off("event", handler)
  }
}
