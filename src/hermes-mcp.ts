export {}

type JsonRpcId = string | number | null

type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, any>
}

const dashboardUrl = (process.env.UNION_DASHBOARD_URL || "http://127.0.0.1:7332").replace(/\/+$/, "")

const tools = [
  {
    name: "health",
    description: "Check whether the local Union control plane is running and reachable.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_agents",
    description: "List AI endpoints currently connected to Union, including provider, title, status, capabilities, and whether Union is already delegating work to them.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "spawn_agent",
    description: "Open a fresh browser-backed ChatGPT or DeepSeek session through Union and wait until it registers as a usable endpoint. New tabs stay in the background unless active=true.",
    inputSchema: {
      type: "object",
      required: ["system"],
      properties: {
        system: {
          type: "string",
          enum: ["ChatGPT", "DeepSeek"],
          description: "Provider to open in a fresh browser tab.",
        },
        active: {
          type: "boolean",
          description: "Whether the spawned browser tab should take focus. Defaults to false.",
        },
        timeout_ms: {
          type: "integer",
          description: "Maximum time to wait for the new tab to register with Union.",
          minimum: 5000,
          maximum: 60000,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "delegate",
    description: "Outsource a bounded compute/reasoning subtask to a connected AI endpoint inside Union and wait for that endpoint's settled final response. Select a specific endpoint when identity matters; otherwise Union chooses an available matching endpoint.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: {
          type: "string",
          description: "Complete task or prompt to send to the Union-connected agent.",
          minLength: 1,
        },
        endpoint_id: {
          type: "string",
          description: "Exact Union endpoint id from list_agents.",
        },
        system: {
          type: "string",
          description: "Optional provider/system filter, for example ChatGPT or DeepSeek.",
        },
        title_contains: {
          type: "string",
          description: "Optional case-insensitive substring filter for the endpoint title.",
        },
        timeout_ms: {
          type: "integer",
          description: "Maximum time to wait for the delegated agent's settled response. Union clamps this to 5,000-600,000 ms.",
          minimum: 5000,
          maximum: 600000,
        },
        allow_busy: {
          type: "boolean",
          description: "Allow dispatch to an endpoint that currently reports working. Defaults to false and should normally stay false.",
        },
        fresh_session: {
          type: "boolean",
          description: "Open a brand-new session for this delegation instead of reusing an existing endpoint. Requires system=ChatGPT or system=DeepSeek.",
        },
        spawn_if_needed: {
          type: "boolean",
          description: "If no matching idle endpoint is available, automatically open a fresh session for the requested system and delegate to it.",
        },
      },
      additionalProperties: false,
    },
  },
]

function write(message: unknown) {
  process.stdout.write(JSON.stringify(message) + "\n")
}

function rpcResult(id: JsonRpcId, result: unknown) {
  write({ jsonrpc: "2.0", id, result })
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  write({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  })
}

async function callUnion(path: string, init?: RequestInit, timeoutMs = 15_000) {
  const response = await fetch(dashboardUrl + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })

  const raw = await response.text()
  let data: any
  try {
    data = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error("Union returned invalid JSON: " + raw.slice(0, 400))
  }

  if (!response.ok) {
    throw new Error(data?.error || ("Union request failed with HTTP " + response.status))
  }
  return data
}

function toolResult(value: any, text?: string) {
  return {
    content: [
      {
        type: "text",
        text: text || JSON.stringify(value, null, 2),
      },
    ],
    structuredContent: value,
  }
}

async function callTool(name: string, args: Record<string, any>) {
  if (name === "health") {
    const result = await callUnion("/api/health")
    return toolResult(
      { ...result, dashboardUrl },
      "Union is reachable at " + dashboardUrl,
    )
  }

  if (name === "list_agents") {
    const result = await callUnion("/api/agents")
    const count = Array.isArray(result?.agents) ? result.agents.length : 0
    return toolResult(result, "Union reports " + count + " connected endpoint(s).\n\n" + JSON.stringify(result, null, 2))
  }

  if (name === "spawn_agent") {
    const system = String(args?.system || "").trim()
    if (!system) throw new Error("system is required")

    const timeoutMs = Number.isFinite(Number(args?.timeout_ms))
      ? Math.max(5_000, Math.min(Number(args.timeout_ms), 60_000))
      : 30_000

    const result = await callUnion(
      "/api/agents/spawn",
      {
        method: "POST",
        body: JSON.stringify({
          system,
          active: args?.active === true,
          timeoutMs,
          source: "hermes",
        }),
      },
      timeoutMs + 10_000,
    )

    const endpoint = result?.endpoint
    const label = endpoint
      ? String(endpoint.system || system) + (endpoint.id ? " — " + endpoint.id : "")
      : system

    return toolResult(
      result,
      "Spawned fresh Union agent: " + label,
    )
  }

  if (name === "delegate") {
    const task = String(args?.task || "").trim()
    if (!task) throw new Error("task is required")

    const timeoutMs = Number.isFinite(Number(args?.timeout_ms))
      ? Math.max(5_000, Math.min(Number(args.timeout_ms), 600_000))
      : 180_000

    const body = {
      task,
      endpointId: args?.endpoint_id,
      system: args?.system,
      titleContains: args?.title_contains,
      timeoutMs,
      allowBusy: args?.allow_busy === true,
      freshSession: args?.fresh_session === true,
      spawnIfNeeded: args?.spawn_if_needed === true,
      source: "hermes",
    }

    const result = await callUnion(
      "/api/delegate",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      timeoutMs + 15_000,
    )

    const endpoint = result?.endpoint
    const label = endpoint
      ? String(endpoint.system || "agent") + (endpoint.title ? " — " + endpoint.title : "")
      : "Union agent"
    const response = String(result?.response || "")

    return toolResult(
      result,
      "Delegated to " + label + ".\n\n" + response,
    )
  }

  throw new Error("Unknown Union tool: " + name)
}

async function handle(message: JsonRpcRequest) {
  if (!message || message.jsonrpc !== "2.0" || !message.method) return
  const hasId = Object.prototype.hasOwnProperty.call(message, "id")
  const id = hasId ? (message.id ?? null) : null

  try {
    if (message.method === "initialize") {
      if (!hasId) return
      const requestedVersion = String(message.params?.protocolVersion || "2025-06-18")
      return rpcResult(id, {
        protocolVersion: requestedVersion,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: "union",
          version: "0.1.0",
        },
        instructions: "Union exposes browser-backed AI endpoints as delegated compute. Use list_agents to inspect available workers, spawn_agent to open fresh ChatGPT or DeepSeek sessions, and delegate to outsource bounded reasoning or generation work. For isolation, use fresh_session. For elastic capacity, use spawn_if_needed with a specific system.",
      })
    }

    if (message.method === "notifications/initialized") return
    if (message.method === "notifications/cancelled") return

    if (message.method === "ping") {
      if (hasId) rpcResult(id, {})
      return
    }

    if (message.method === "tools/list") {
      if (hasId) rpcResult(id, { tools })
      return
    }

    if (message.method === "tools/call") {
      if (!hasId) return
      const name = String(message.params?.name || "")
      const args = (message.params?.arguments || {}) as Record<string, any>
      try {
        const result = await callTool(name, args)
        rpcResult(id, result)
      } catch (error) {
        rpcResult(id, {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        })
      }
      return
    }

    if (hasId) rpcError(id, -32601, "Method not found: " + message.method)
  } catch (error) {
    if (hasId) {
      rpcError(
        id,
        -32603,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

let buffer = ""
process.stdin.setEncoding("utf8")

for await (const chunk of process.stdin) {
  buffer += chunk
  while (true) {
    const newline = buffer.indexOf("\n")
    if (newline < 0) break

    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue

    try {
      await handle(JSON.parse(line))
    } catch (error) {
      console.error("Union MCP parse error:", error)
    }
  }
}
