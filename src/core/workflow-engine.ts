import { id } from "./id"
import type { Endpoint } from "./types"
import type {
  ContextContract,
  ContextPacket,
  HandshakeMode,
  HandshakeResult,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowModule,
  WorkflowNode,
  WorkflowRun,
} from "./workflow"
import type { UnionRuntime } from "./runtime"

type ExecutionContext = {
  run: WorkflowRun
  definition: WorkflowDefinition
}

export class WorkflowEngine {
  private runs = new Map<string, WorkflowRun>()
  private stopRequested = new Set<string>()

  constructor(private runtime: UnionRuntime) {}

  listRuns() {
    return [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  getRun(id: string) {
    return this.runs.get(id)
  }

  stop(runId: string) {
    const run = this.runs.get(runId)
    if (!run || !["queued", "running"].includes(run.status)) return false
    this.stopRequested.add(runId)
    run.status = "stopped"
    run.completedAt = Date.now()
    this.emit("workflow.run.stopped", { runId })
    return true
  }

  start(definition: WorkflowDefinition, input: string) {
    this.validate(definition)
    const runId = id("run")
    const packet: ContextPacket = {
      runId,
      taskId: id("task"),
      stateVersion: 0,
      payload: input.trim(),
      sharedState: {
        goals: [],
        facts: [],
        decisions: [],
        openQuestions: [],
        risks: [],
        nextActions: [],
      },
      protocol: { version: 1, symbols: {} },
      artifacts: [],
      trace: [],
    }

    const run: WorkflowRun = {
      id: runId,
      workflowId: definition.id,
      workflowName: definition.name,
      status: "queued",
      startedAt: Date.now(),
      packet,
    }

    this.runs.set(runId, run)
    void this.execute(definition, run)
    return run
  }

  private async execute(definition: WorkflowDefinition, run: WorkflowRun) {
    run.status = "running"
    this.emit("workflow.run.started", {
      runId: run.id,
      workflowId: definition.id,
      workflowName: definition.name,
    })

    try {
      run.packet = await this.executeModule(definition.rootModuleId, run.packet, {
        run,
        definition,
      })
      if (this.stopRequested.has(run.id)) return

      run.status = "completed"
      run.completedAt = Date.now()
      this.emit("workflow.run.completed", {
        runId: run.id,
        stateVersion: run.packet.stateVersion,
        chars: run.packet.payload.length,
        durationMs: run.completedAt - run.startedAt,
      })
    } catch (error) {
      if (this.stopRequested.has(run.id)) return
      run.status = "failed"
      run.completedAt = Date.now()
      run.error = error instanceof Error ? error.message : String(error)
      this.emit("workflow.run.failed", {
        runId: run.id,
        error: run.error,
      })
    }
  }

  private async executeModule(moduleId: string, packet: ContextPacket, ctx: ExecutionContext): Promise<ContextPacket> {
    const module = ctx.definition.modules[moduleId]
    if (!module) throw new Error(`Missing module: ${moduleId}`)
    const cycles = Math.max(1, module.cycles ?? 1)

    this.emit("workflow.module.started", {
      runId: ctx.run.id,
      moduleId,
      strategy: module.strategy,
      cycles,
    })

    let current = packet
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      this.assertRunning(ctx.run)
      ctx.run.currentModuleId = moduleId
      ctx.run.currentCycle = cycle

      if (["ping_pong", "critique_loop", "debate"].includes(module.strategy)) {
        current = await this.executePingPong(module, current, ctx, cycle)
      } else if (module.strategy === "parallel") {
        current = await this.executeParallel(module, current, ctx, cycle)
      } else {
        current = await this.executeSequential(module, current, ctx, cycle)
      }
    }

    this.emit("workflow.module.completed", {
      runId: ctx.run.id,
      moduleId,
      stateVersion: current.stateVersion,
    })
    return current
  }

  private async executeSequential(module: WorkflowModule, packet: ContextPacket, ctx: ExecutionContext, cycle: number) {
    const order = this.topologicalOrder(module)
    const executed = new Set<string>()
    let current = packet

    for (const node of order) {
      this.assertRunning(ctx.run)
      const incoming = module.edges.find((edge) => edge.to === node.id && executed.has(edge.from))
      if (incoming) {
        const source = module.nodes.find((item) => item.id === incoming.from)
        if (source) await this.handshake(source, node, incoming, current, ctx)
      }

      current = await this.executeNode(
        node,
        current,
        ctx,
        module.id,
        cycle,
        current.trace.length + 1,
        incoming?.contract,
      )
      executed.add(node.id)
    }

    return current
  }

  private async executePingPong(module: WorkflowModule, packet: ContextPacket, ctx: ExecutionContext, cycle: number) {
    const workers = module.nodes.filter((node) =>
      node.enabled !== false && (node.kind === "agent" || node.kind === "module")
    )
    if (workers.length !== 2) {
      throw new Error(`${module.name} requires exactly two agent/module nodes for ${module.strategy}`)
    }

    const turns = Math.max(2, module.turns ?? 4)
    let current = packet

    for (let turn = 1; turn <= turns; turn += 1) {
      this.assertRunning(ctx.run)
      const node = workers[(turn - 1) % workers.length]
      const previous = turn > 1 ? workers[(turn - 2) % workers.length] : undefined

      let contract: ContextContract | undefined
      if (previous) {
        const edge =
          module.edges.find((item) => item.from === previous.id && item.to === node.id) ??
          module.edges.find((item) => item.from === node.id && item.to === previous.id) ??
          {
            id: `synthetic:${previous.id}:${node.id}`,
            from: previous.id,
            to: node.id,
            contract: { handshake: "deterministic" as HandshakeMode },
          }
        contract = edge.contract
        await this.handshake(previous, node, edge, current, ctx)
      }

      ctx.run.currentTurn = turn
      current = await this.executeNode(node, current, ctx, module.id, cycle, turn, contract)
    }

    return current
  }

  private async executeParallel(module: WorkflowModule, packet: ContextPacket, ctx: ExecutionContext, cycle: number) {
    const workers = module.nodes.filter((node) =>
      node.enabled !== false && (node.kind === "agent" || node.kind === "module")
    )
    if (!workers.length) return packet

    const outputs = await Promise.all(
      workers.map((node, index) => this.executeNode(node, packet, ctx, module.id, cycle, index + 1))
    )

    return {
      ...packet,
      stateVersion: Math.max(...outputs.map((item) => item.stateVersion)) + 1,
      payload: outputs.map((item, index) => `## ${workers[index].label}\n\n${item.payload}`).join("\n\n"),
      trace: outputs.flatMap((item) => item.trace).slice(-200),
    }
  }

  private async executeNode(
    node: WorkflowNode,
    packet: ContextPacket,
    ctx: ExecutionContext,
    moduleId: string,
    cycle: number,
    turn: number,
    contract?: ContextContract,
  ): Promise<ContextPacket> {
    if (node.enabled === false) return packet
    ctx.run.currentNodeId = node.id
    ctx.run.currentModuleId = moduleId
    ctx.run.currentCycle = cycle
    ctx.run.currentTurn = turn

    this.emit("workflow.node.started", {
      runId: ctx.run.id,
      moduleId,
      nodeId: node.id,
      nodeKind: node.kind,
      label: node.label,
      cycle,
      turn,
    })

    let next = packet
    if (node.kind === "agent") {
      next = await this.executeAgent(node, packet, ctx, moduleId, cycle, turn, contract)
    } else if (node.kind === "module") {
      if (!node.module?.moduleId) throw new Error(`Module node ${node.label} has no moduleId`)
      next = await this.executeModule(node.module.moduleId, packet, ctx)
    }

    this.emit("workflow.node.completed", {
      runId: ctx.run.id,
      moduleId,
      nodeId: node.id,
      label: node.label,
      stateVersion: next.stateVersion,
      chars: next.payload.length,
      cycle,
      turn,
    })

    ctx.run.packet = next
    return next
  }

  private async executeAgent(
    node: WorkflowNode,
    packet: ContextPacket,
    ctx: ExecutionContext,
    moduleId: string,
    cycle: number,
    turn: number,
    contract?: ContextContract,
  ): Promise<ContextPacket> {
    const endpoint = this.endpointFor(node)
    const before = await this.runtime.adapters.readLatest(endpoint).catch(() => "")
    const prompt = this.agentPrompt(node, packet, moduleId, cycle, turn, contract)

    await this.runtime.send(endpoint, prompt, true, false)
    const response = await this.runtime.waitForAssistantReply(endpoint, before)

    return {
      ...packet,
      stateVersion: packet.stateVersion + 1,
      payload: response,
      loop: { moduleId, cycle, turn },
      trace: [
        ...packet.trace,
        {
          nodeId: node.id,
          moduleId,
          stateVersion: packet.stateVersion + 1,
          at: Date.now(),
          chars: response.length,
        },
      ].slice(-200),
    }
  }

  private async handshake(
    source: WorkflowNode,
    target: WorkflowNode,
    edge: WorkflowEdge,
    packet: ContextPacket,
    ctx: ExecutionContext,
  ) {
    const mode = edge.contract?.handshake ?? "deterministic"
    if (mode === "none") return

    const result = this.deterministicHandshake(source, target, edge.contract, packet)
    if (mode === "model" && result.aligned && target.kind === "agent") {
      const endpoint = this.endpointFor(target)
      const before = await this.runtime.adapters.readLatest(endpoint).catch(() => "")
      const prompt = [
        "UNION CONTEXT HANDSHAKE",
        "",
        `Task: ${packet.taskId}`,
        `State version: ${packet.stateVersion}`,
        `Protocol version: ${packet.protocol.version}`,
        `Incoming source: ${source.label}`,
        `Your role: ${target.agent?.role || target.label}`,
        "",
        "Reply with exactly ACK if the context identity and role are clear.",
        "Otherwise reply MISMATCH:<brief reason>.",
      ].join("\n")

      await this.runtime.send(endpoint, prompt, true, false)
      const answer = await this.runtime.waitForAssistantReply(endpoint, before)
      result.evidence = answer.slice(0, 240)
      if (!/^ACK\b/i.test(answer.trim())) {
        result.aligned = false
        result.issues.push(`Model handshake rejected: ${answer.slice(0, 160)}`)
      }
    }

    this.emit("workflow.handshake", {
      runId: ctx.run.id,
      edgeId: edge.id,
      ...result,
    })

    if (!result.aligned) {
      throw new Error(`Context handshake failed ${source.label} → ${target.label}: ${result.issues.join("; ")}`)
    }
  }

  private deterministicHandshake(
    source: WorkflowNode,
    target: WorkflowNode,
    contract: ContextContract | undefined,
    packet: ContextPacket,
  ): HandshakeResult {
    const issues: string[] = []
    const sourceSchema = source.agent?.outputSchema || contract?.outputSchema
    const targetSchema = target.agent?.inputSchema || contract?.inputSchema

    if (sourceSchema && targetSchema && sourceSchema !== targetSchema) {
      issues.push(`Schema mismatch: ${sourceSchema} → ${targetSchema}`)
    }

    return {
      aligned: issues.length === 0,
      mode: contract?.handshake ?? "deterministic",
      sourceNodeId: source.id,
      targetNodeId: target.id,
      stateVersion: packet.stateVersion,
      protocolVersion: packet.protocol.version,
      issues,
    }
  }

  private agentPrompt(
    node: WorkflowNode,
    packet: ContextPacket,
    moduleId: string,
    cycle: number,
    turn: number,
    contract?: ContextContract,
  ) {
    const include = new Set<NonNullable<ContextContract["include"]>[number]>(
      contract?.include ?? ["payload", "shared_state", "protocol", "artifacts"],
    )
    const maxChars = Math.max(0, contract?.maxChars ?? 0)
    const payload = include.has("payload")
      ? (maxChars > 0 ? packet.payload.slice(-maxChars) : packet.payload)
      : ""

    const sections = [
      "You are an AI worker inside a Union context-production workflow.",
      "",
      "WORKFLOW IDENTITY",
      `Run: ${packet.runId}`,
      `Task: ${packet.taskId}`,
      `Module: ${moduleId}`,
      `Cycle: ${cycle}`,
      `Turn: ${turn}`,
      `Context state: v${packet.stateVersion}`,
      `Protocol: v${packet.protocol.version}`,
      "",
      "YOUR ROLE",
      node.agent?.role || node.label,
      node.agent?.instructions || "Transform the incoming context into a stronger work product for the next stage.",
      "",
    ]

    if (include.has("shared_state")) {
      sections.push(
        "SHARED STATE",
        JSON.stringify(packet.sharedState),
        "",
      )
    }

    if (include.has("protocol") && Object.keys(packet.protocol.symbols).length) {
      sections.push("SHARED PROTOCOL", JSON.stringify(packet.protocol.symbols), "")
    }

    if (include.has("artifacts") && packet.artifacts.length) {
      sections.push("ARTIFACTS", JSON.stringify(packet.artifacts), "")
    }

    if (include.has("payload")) sections.push(
      "INCOMING CONTEXT",
      payload,
      "",
      "OUTPUT CONTRACT",
      node.agent?.outputSchema
        ? `Produce output compatible with: ${node.agent.outputSchema}`
        : "Return the improved work product that should move to the next node.",
      "Do not describe the orchestration mechanics unless they are directly relevant to the task.",
    )

    return sections.join("\n")
  }

  private endpointFor(node: WorkflowNode): Endpoint {
    const endpointId = node.agent?.endpointId
    if (!endpointId) throw new Error(`Agent node ${node.label} has no endpointId`)
    const endpoint = this.runtime.endpoints().find((item) => item.id === endpointId)
    if (!endpoint || endpoint.status === "offline") {
      throw new Error(`Endpoint unavailable for ${node.label}: ${endpointId}`)
    }
    return endpoint
  }

  private topologicalOrder(module: WorkflowModule) {
    const nodes = module.nodes.filter((node) => node.enabled !== false)
    const indegree = new Map(nodes.map((node) => [node.id, 0]))
    const outgoing = new Map<string, string[]>()

    for (const edge of module.edges) {
      if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
    }

    const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0)
    const ordered: WorkflowNode[] = []

    while (queue.length) {
      const node = queue.shift()!
      ordered.push(node)
      for (const target of outgoing.get(node.id) ?? []) {
        indegree.set(target, (indegree.get(target) ?? 1) - 1)
        if (indegree.get(target) === 0) {
          const next = nodes.find((candidate) => candidate.id === target)
          if (next) queue.push(next)
        }
      }
    }

    return ordered.length === nodes.length ? ordered : nodes
  }

  private validate(definition: WorkflowDefinition) {
    if (!definition.id || !definition.name) throw new Error("Workflow requires id and name")
    if (!definition.modules[definition.rootModuleId]) {
      throw new Error(`Missing root module: ${definition.rootModuleId}`)
    }

    for (const module of Object.values(definition.modules)) {
      const ids = new Set(module.nodes.map((node) => node.id))
      if (ids.size !== module.nodes.length) throw new Error(`Duplicate node id in module ${module.name}`)
      for (const edge of module.edges) {
        if (!ids.has(edge.from) || !ids.has(edge.to)) {
          throw new Error(`Invalid edge ${edge.id} in module ${module.name}`)
        }
      }
      for (const node of module.nodes) {
        if (node.kind === "module" && node.module?.moduleId && !definition.modules[node.module.moduleId]) {
          throw new Error(`Node ${node.label} references missing module ${node.module.moduleId}`)
        }
      }
    }
  }

  private assertRunning(run: WorkflowRun) {
    if (this.stopRequested.has(run.id) || run.status === "stopped") {
      throw new Error("Run stopped")
    }
  }

  private emit(action: string, payload: Record<string, unknown>) {
    this.runtime.events.emit("system", { action, ...payload }, { subject: "Workflows" })
  }
}
