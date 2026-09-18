export type UnionStatus = "working" | "waiting" | "needs_you" | "done" | "failed" | "paused" | "offline"

export type Capability =
  | "discover"
  | "read"
  | "send"
  | "submit"
  | "interrupt"
  | "files"
  | "tools"
  | "stream"

export type Endpoint = {
  id: string
  adapterId: string
  system: string
  title: string
  subject?: string
  status: UnionStatus
  capabilities: Capability[]
  externalId?: string
  url?: string
  metadata?: Record<string, unknown>
  updatedAt: number
}

export type UnionMessage = {
  id: string
  endpointId: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  createdAt: number
  metadata?: Record<string, unknown>
}

export type FileRecord = {
  id: string
  path: string
  title: string
  subject: string
  extension: string
  size: number
  modifiedAt: number
  indexedAt: number
  summary?: string
  canonical?: boolean
}

export type SubjectRecord = {
  id: string
  title: string
  fileCount: number
  activeCount: number
  updatedAt: number
}

export type UnionEventType =
  | "file.indexed"
  | "file.changed"
  | "endpoint.connected"
  | "endpoint.disconnected"
  | "endpoint.status"
  | "message.received"
  | "message.sent"
  | "context.compiled"
  | "subject.assigned"
  | "system"

export type UnionEvent = {
  id: string
  type: UnionEventType
  objectId?: string
  subject?: string
  payload: Record<string, unknown>
  createdAt: number
}

export type ContextItem = {
  kind: "file" | "message" | "endpoint" | "memory"
  id: string
  title: string
  score: number
  reason: string
  content?: string
  path?: string
}

export type ContextPack = {
  subject?: string
  focusId?: string
  items: ContextItem[]
  estimatedChars: number
  createdAt: number
}

export interface UnionAdapter {
  id: string
  label: string
  capabilities: Capability[]
  discover(): Promise<Endpoint[]>
  read(endpointId: string): Promise<UnionMessage[]>
  send(endpointId: string, content: string, submit?: boolean): Promise<void>
  interrupt?(endpointId: string): Promise<void>
  dispose?(): Promise<void>
}
