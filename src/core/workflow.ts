import type { UnionStatus } from "./types"

export type WorkflowNodeKind =
  | "agent"
  | "module"
  | "router"
  | "context"
  | "tool"
  | "input"
  | "output"

export type ModuleStrategy =
  | "sequential"
  | "ping_pong"
  | "parallel"
  | "debate"
  | "critique_loop"
  | "map_reduce"
  | "supervisor"

export type HandshakeMode = "none" | "deterministic" | "model"

export type WorkflowPosition = {
  x: number
  y: number
}

export type AgentNodeConfig = {
  endpointId: string
  role?: string
  instructions?: string
  inputSchema?: string
  outputSchema?: string
}

export type ModuleNodeConfig = {
  moduleId: string
}

export type ContextNodeConfig = {
  mode?: "memory" | "checkpoint" | "passthrough"
  keys?: string[]
}

export type RouterNodeConfig = {
  expression?: string
}

export type ToolNodeConfig = {
  toolId?: string
  instructions?: string
}

export type WorkflowNode = {
  id: string
  kind: WorkflowNodeKind
  label: string
  position: WorkflowPosition
  enabled?: boolean
  agent?: AgentNodeConfig
  module?: ModuleNodeConfig
  context?: ContextNodeConfig
  router?: RouterNodeConfig
  tool?: ToolNodeConfig
}

export type ContextContract = {
  handshake?: HandshakeMode
  include?: Array<"payload" | "shared_state" | "protocol" | "artifacts" | "trace">
  maxChars?: number
  inputSchema?: string
  outputSchema?: string
}

export type WorkflowEdge = {
  id: string
  from: string
  to: string
  label?: string
  contract?: ContextContract
}

export type WorkflowModule = {
  id: string
  name: string
  strategy: ModuleStrategy
  turns?: number
  cycles?: number
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export type WorkflowDefinition = {
  id: string
  name: string
  version: number
  rootModuleId: string
  modules: Record<string, WorkflowModule>
}

export type ContextArtifact = {
  id: string
  name: string
  kind: string
  uri?: string
  summary?: string
}

export type SharedState = {
  goals: string[]
  facts: string[]
  decisions: string[]
  openQuestions: string[]
  risks: string[]
  nextActions: string[]
}

export type ProtocolDictionary = {
  version: number
  symbols: Record<string, string>
}

export type ContextTraceEntry = {
  nodeId: string
  moduleId: string
  stateVersion: number
  at: number
  chars: number
}

export type ContextPacket = {
  runId: string
  taskId: string
  stateVersion: number
  payload: string
  sharedState: SharedState
  protocol: ProtocolDictionary
  artifacts: ContextArtifact[]
  trace: ContextTraceEntry[]
  loop?: {
    moduleId: string
    cycle: number
    turn: number
  }
}

export type HandshakeResult = {
  aligned: boolean
  mode: HandshakeMode
  sourceNodeId: string
  targetNodeId: string
  stateVersion: number
  protocolVersion: number
  issues: string[]
  evidence?: string
}

export type WorkflowRunStatus = "queued" | "running" | "completed" | "failed" | "stopped"

export type WorkflowRun = {
  id: string
  workflowId: string
  workflowName: string
  status: WorkflowRunStatus
  startedAt: number
  completedAt?: number
  currentModuleId?: string
  currentNodeId?: string
  currentCycle?: number
  currentTurn?: number
  error?: string
  packet: ContextPacket
}

export type DashboardEndpoint = {
  id: string
  system: string
  title: string
  status: UnionStatus
  url?: string
}
