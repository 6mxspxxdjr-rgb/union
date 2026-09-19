(() => {
  const $ = (id) => document.getElementById(id)
  const surface = $("graphSurface")
  const nodesLayer = $("nodesLayer")
  const edgeLayer = $("edgeLayer")
  const toast = $("toast")
  const handshakeToast = $("handshakeToast")
  const handshakeText = $("handshakeText")

  const state = {
    endpoints: [],
    nodes: [],
    edges: [],
    selectedNodeId: null,
    activeRunId: null,
    activeNodeId: null,
    activeModuleId: null,
    rootCycles: 1,
    events: [],
    seeded: false,
  }

  let drag = null
  let wire = null
  let draftPath = null
  let socket = null
  let socketRetry = null

  function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
  }

  function baseNodes() {
    return [
      {
        id: "input",
        kind: "input",
        label: "Problem Input",
        x: 52,
        y: 150,
        status: "ready",
      },
      {
        id: "output",
        kind: "output",
        label: "Final Output",
        x: 760,
        y: 150,
        status: "ready",
      },
    ]
  }

  function loadGraph() {
    try {
      const raw = localStorage.getItem("union.workflow.v1")
      if (!raw) {
        state.nodes = baseNodes()
        return
      }
      const saved = JSON.parse(raw)
      state.nodes = Array.isArray(saved.nodes) && saved.nodes.length ? saved.nodes : baseNodes()
      state.edges = Array.isArray(saved.edges) ? saved.edges : []
      state.rootCycles = Math.max(1, Number(saved.rootCycles || 1))
      $("rootCycles").value = String(state.rootCycles)
      state.seeded = Boolean(saved.seeded)
    } catch {
      state.nodes = baseNodes()
      state.edges = []
    }
  }

  function saveGraph(silent = true) {
    localStorage.setItem(
      "union.workflow.v1",
      JSON.stringify({
        nodes: state.nodes,
        edges: state.edges,
        rootCycles: state.rootCycles,
        seeded: state.seeded,
      }),
    )
    if (!silent) showToast("Workflow saved locally")
  }

  function showToast(message) {
    toast.textContent = message
    toast.classList.add("show")
    clearTimeout(showToast.timer)
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800)
  }

  function endpointById(id) {
    return state.endpoints.find((endpoint) => endpoint.id === id)
  }

  function selectedNode() {
    return state.nodes.find((node) => node.id === state.selectedNodeId)
  }

  function nodeIcon(node) {
    if (node.kind === "agent") {
      const endpoint = endpointById(node.endpointId)
      return endpoint?.system === "DeepSeek" ? "◕" : "◎"
    }
    if (node.kind === "module") return "∞"
    if (node.kind === "context") return "▱"
    if (node.kind === "input") return "→"
    if (node.kind === "output") return "✓"
    return "◇"
  }

  function nodeSub(node) {
    if (node.kind === "agent") {
      const endpoint = endpointById(node.endpointId)
      return `${endpoint?.system || "Unbound"} • ${node.role || "worker"}`
    }
    if (node.kind === "module") return `Pair loop • ${node.turns || 5} turns`
    if (node.kind === "context") return node.contextMode || "passthrough"
    if (node.kind === "input") return "Context₀"
    if (node.kind === "output") return "Production result"
    return node.kind
  }

  function nodeStatus(node) {
    if (state.activeNodeId === node.id) return "running"
    if (node.kind === "module" && state.activeModuleId === node.moduleId) return "running"
    if (node.kind === "agent") return endpointById(node.endpointId)?.status || "offline"
    return node.status || "waiting"
  }

  function renderNodes() {
    nodesLayer.innerHTML = ""
    for (const node of state.nodes) {
      const el = document.createElement("div")
      el.className = `node ${node.kind} ${state.selectedNodeId === node.id ? "selected" : ""} ${nodeStatus(node) === "running" || nodeStatus(node) === "working" ? "running" : ""}`
      el.dataset.id = node.id
      el.style.left = `${node.x}px`
      el.style.top = `${node.y}px`
      el.innerHTML = `
        <div class="node-shell">
          <div class="node-icon">${nodeIcon(node)}</div>
          <div>
            <div class="node-name">${escapeHtml(node.label)}</div>
            <div class="node-sub">${escapeHtml(nodeSub(node))}</div>
          </div>
        </div>
        ${node.kind !== "input" ? '<div class="port in" title="Context input"></div>' : ""}
        ${node.kind !== "output" ? '<div class="port out" title="Context output"></div>' : ""}
        <div class="node-status">
          <span class="status-light"></span>
          <span>${escapeHtml(nodeStatus(node))}</span>
        </div>
      `
      nodesLayer.appendChild(el)
    }
    requestAnimationFrame(renderEdges)
  }

  function portPoint(nodeId, side) {
    const node = nodesLayer.querySelector(`.node[data-id="${CSS.escape(nodeId)}"]`)
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const root = surface.getBoundingClientRect()
    return {
      x: (side === "out" ? rect.right : rect.left) - root.left,
      y: rect.top - root.top + 36,
    }
  }

  function pathD(a, b) {
    const dx = Math.max(58, Math.abs(b.x - a.x) * 0.45)
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
  }

  function svgPath(className, d) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("class", className)
    path.setAttribute("d", d)
    return path
  }

  function renderEdges() {
    edgeLayer.querySelectorAll(".edge-group").forEach((item) => item.remove())
    for (const edge of state.edges) {
      const a = portPoint(edge.from, "out")
      const b = portPoint(edge.to, "in")
      if (!a || !b) continue

      const group = document.createElementNS("http://www.w3.org/2000/svg", "g")
      group.setAttribute("class", `edge-group ${edge.active ? "active" : ""}`)
      group.dataset.id = edge.id
      const d = pathD(a, b)
      const source = state.nodes.find((node) => node.id === edge.from)
      const visible = svgPath(
        `edge-visible ${source?.kind === "module" ? "module-edge" : ""}`,
        d,
      )
      const dash = svgPath("edge-dash", d)
      const hit = svgPath("edge-hit", d)
      hit.addEventListener("dblclick", () => {
        state.edges = state.edges.filter((item) => item.id !== edge.id)
        saveGraph()
        renderEdges()
        showToast("Connection removed")
      })
      group.append(hit, visible, dash)
      edgeLayer.appendChild(group)
    }
  }

  function addEdge(from, to) {
    if (!from || !to || from === to) return
    if (state.edges.some((edge) => edge.from === from && edge.to === to)) return
    state.edges.push({
      id: uid("edge"),
      from,
      to,
      contract: {
        handshake: "deterministic",
        include: ["payload", "shared_state", "protocol", "artifacts"],
      },
    })
    saveGraph()
    renderEdges()
    flashHandshake(from, to, "Context contract established")
  }

  function addAgent(endpointId) {
    const endpoint = endpointById(endpointId)
    if (!endpoint) return
    const count = state.nodes.filter((node) => node.kind === "agent").length
    const node = {
      id: uid("agent"),
      kind: "agent",
      label: endpoint.title || endpoint.system,
      x: 250 + (count % 3) * 205,
      y: 85 + (count % 2) * 145,
      endpointId,
      role: "Context developer",
      instructions: "Improve the incoming work product and pass forward only useful, task-relevant context.",
      outputSchema: "",
    }
    state.nodes.push(node)
    state.selectedNodeId = node.id
    saveGraph()
    renderAll()
  }

  function addPairLoop() {
    const online = state.endpoints.filter((endpoint) => endpoint.status !== "offline")
    const node = {
      id: uid("module"),
      kind: "module",
      label: "Refinement Loop",
      x: 310,
      y: 185,
      moduleId: uid("pair"),
      agentA: online[0]?.id || "",
      agentB: online[1]?.id || "",
      turns: 5,
    }
    state.nodes.push(node)
    state.selectedNodeId = node.id
    saveGraph()
    renderAll()
    showToast("Pair loop added — assign its two agents in Inspector")
  }

  function addContext() {
    const node = {
      id: uid("context"),
      kind: "context",
      label: "Context Checkpoint",
      x: 540,
      y: 250,
      contextMode: "checkpoint",
    }
    state.nodes.push(node)
    state.selectedNodeId = node.id
    saveGraph()
    renderAll()
  }

  function deleteSelectedNode() {
    const node = selectedNode()
    if (!node || node.kind === "input" || node.kind === "output") {
      showToast("Input and output boundaries cannot be deleted")
      return
    }
    state.nodes = state.nodes.filter((item) => item.id !== node.id)
    state.edges = state.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id)
    state.selectedNodeId = null
    saveGraph()
    renderAll()
  }

  function renderEndpoints() {
    const list = $("endpointList")
    list.innerHTML = ""
    if (!state.endpoints.length) {
      list.innerHTML = '<div style="font-size:9px;color:#6f89a4;padding:8px">No browser agents connected yet.</div>'
      return
    }
    for (const endpoint of state.endpoints) {
      const card = document.createElement("div")
      card.className = "endpoint-card"
      card.innerHTML = `
        <div class="endpoint-icon">${endpoint.system === "DeepSeek" ? "◕" : "◎"}</div>
        <div>
          <b><span class="endpoint-dot ${endpoint.status}"></span>${escapeHtml(endpoint.system)}</b>
          <small title="${escapeHtml(endpoint.title)}">${escapeHtml(endpoint.title)}</small>
        </div>
        <button class="endpoint-add" title="Add this browser session to the graph">＋</button>
      `
      card.querySelector(".endpoint-add").addEventListener("click", () => addAgent(endpoint.id))
      list.appendChild(card)
    }
  }

  function seedFromEndpoints() {
    if (state.seeded || !state.endpoints.length) return
    const candidates = [
      state.endpoints.find((endpoint) => endpoint.system === "ChatGPT" && endpoint.status !== "offline"),
      state.endpoints.find((endpoint) => endpoint.system === "DeepSeek" && endpoint.status !== "offline"),
    ].filter(Boolean)

    if (!candidates.length) return
    const unique = [...new Map(candidates.map((item) => [item.id, item])).values()]
    const added = []
    unique.forEach((endpoint, index) => {
      const node = {
        id: uid("agent"),
        kind: "agent",
        label: endpoint.title || endpoint.system,
        x: 265 + index * 235,
        y: 145 + index * 60,
        endpointId: endpoint.id,
        role: index === 0 ? "Context developer" : "Critical refiner",
        instructions: "Improve the incoming context for the next stage without repeating information that is already established.",
        outputSchema: "",
      }
      state.nodes.push(node)
      added.push(node)
    })

    if (added.length) {
      state.edges = []
      addEdge("input", added[0].id)
      for (let i = 1; i < added.length; i += 1) addEdge(added[i - 1].id, added[i].id)
      addEdge(added.at(-1).id, "output")
      state.seeded = true
      saveGraph()
      renderAll()
    }
  }

  function optionsForEndpoints(selected) {
    const options = ['<option value="">Select endpoint…</option>']
    for (const endpoint of state.endpoints) {
      options.push(
        `<option value="${escapeAttr(endpoint.id)}" ${endpoint.id === selected ? "selected" : ""}>${escapeHtml(endpoint.system)} — ${escapeHtml(endpoint.title)}</option>`,
      )
    }
    return options.join("")
  }

  function renderInspector() {
    const node = selectedNode()
    $("inspectorEmpty").classList.toggle("hidden", Boolean(node))
    $("nodeInspector").classList.toggle("hidden", !node)
    if (!node) return

    $("inspectIcon").textContent = nodeIcon(node)
    $("inspectKind").textContent = node.kind.toUpperCase()
    $("inspectLabel").textContent = node.label
    $("inspectStatus").textContent = nodeStatus(node)
    $("fieldLabel").value = node.label

    $("agentFields").classList.toggle("hidden", node.kind !== "agent")
    $("moduleFields").classList.toggle("hidden", node.kind !== "module")
    $("contextFields").classList.toggle("hidden", node.kind !== "context")

    if (node.kind === "agent") {
      $("fieldEndpoint").innerHTML = optionsForEndpoints(node.endpointId)
      $("fieldRole").value = node.role || ""
      $("fieldInstructions").value = node.instructions || ""
      $("fieldOutputSchema").value = node.outputSchema || ""
    }

    if (node.kind === "module") {
      $("moduleAgentA").innerHTML = optionsForEndpoints(node.agentA)
      $("moduleAgentB").innerHTML = optionsForEndpoints(node.agentB)
      $("moduleTurns").value = String(node.turns || 5)
    }

    if (node.kind === "context") {
      $("contextMode").value = node.contextMode || "passthrough"
    }
  }

  function renderAll() {
    renderEndpoints()
    renderNodes()
    renderInspector()
    updateRunMetrics()
  }

  function buildWorkflow() {
    const rootNodes = state.nodes.map((node) => {
      const base = {
        id: node.id,
        kind: node.kind,
        label: node.label,
        position: { x: node.x, y: node.y },
      }
      if (node.kind === "agent") {
        return {
          ...base,
          agent: {
            endpointId: node.endpointId,
            role: node.role,
            instructions: node.instructions,
            outputSchema: node.outputSchema || undefined,
          },
        }
      }
      if (node.kind === "module") {
        return { ...base, module: { moduleId: node.moduleId } }
      }
      if (node.kind === "context") {
        return { ...base, context: { mode: node.contextMode || "passthrough" } }
      }
      return base
    })

    const modules = {
      root: {
        id: "root",
        name: "Context Production Line",
        strategy: "sequential",
        cycles: Math.max(1, Number(state.rootCycles || 1)),
        nodes: rootNodes,
        edges: state.edges.map((edge) => ({
          id: edge.id,
          from: edge.from,
          to: edge.to,
          contract: edge.contract || {
            handshake: "deterministic",
            include: ["payload", "shared_state", "protocol", "artifacts"],
          },
        })),
      },
    }

    for (const node of state.nodes.filter((item) => item.kind === "module")) {
      modules[node.moduleId] = {
        id: node.moduleId,
        name: node.label,
        strategy: "ping_pong",
        turns: Math.max(2, Number(node.turns || 5)),
        cycles: 1,
        nodes: [
          {
            id: `${node.id}:a`,
            kind: "agent",
            label: "Loop Agent A",
            position: { x: 80, y: 90 },
            agent: {
              endpointId: node.agentA,
              role: "Primary developer",
              instructions: "Advance the incoming work product. Preserve established decisions and add concrete progress.",
            },
          },
          {
            id: `${node.id}:b`,
            kind: "agent",
            label: "Loop Agent B",
            position: { x: 340, y: 90 },
            agent: {
              endpointId: node.agentB,
              role: "Critical refinement partner",
              instructions: "Critique and improve the partner work. Resolve gaps instead of merely agreeing.",
            },
          },
        ],
        edges: [
          {
            id: `${node.id}:ab`,
            from: `${node.id}:a`,
            to: `${node.id}:b`,
            contract: {
              handshake: "deterministic",
              include: ["payload", "shared_state", "protocol", "artifacts"],
            },
          },
          {
            id: `${node.id}:ba`,
            from: `${node.id}:b`,
            to: `${node.id}:a`,
            contract: {
              handshake: "deterministic",
              include: ["payload", "shared_state", "protocol", "artifacts"],
            },
          },
        ],
      }
    }

    return {
      id: "dashboard-workflow",
      name: "Context Production Line",
      version: 1,
      rootModuleId: "root",
      modules,
    }
  }

  function validateForRun() {
    const input = $("taskInput").value.trim()
    if (!input) return "Enter a problem or assignment first."

    const executable = state.nodes.filter((node) => node.kind === "agent" || node.kind === "module")
    if (!executable.length) return "Add at least one agent or module."

    for (const node of executable) {
      if (node.kind === "agent") {
        if (!node.endpointId) return `${node.label} has no browser endpoint.`
        if (endpointById(node.endpointId)?.status === "offline") return `${node.label} is offline.`
      }
      if (node.kind === "module") {
        if (!node.agentA || !node.agentB) return `${node.label} needs two agents.`
        if (node.agentA === node.agentB) return `${node.label} must use two different browser sessions.`
      }
    }

    const reachable = new Set(["input"])
    let changed = true
    while (changed) {
      changed = false
      for (const edge of state.edges) {
        if (reachable.has(edge.from) && !reachable.has(edge.to)) {
          reachable.add(edge.to)
          changed = true
        }
      }
    }
    if (!reachable.has("output")) return "Connect the production line from Problem Input to Final Output."
    return ""
  }

  async function runWorkflow() {
    const error = validateForRun()
    if (error) {
      showToast(error)
      return
    }

    state.rootCycles = Math.max(1, Number($("rootCycles").value || 1))
    saveGraph()
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflow: buildWorkflow(),
        input: $("taskInput").value.trim(),
      }),
    })
    const body = await response.json()
    if (!response.ok) {
      showToast(body.error || "Run failed to start")
      return
    }

    state.activeRunId = body.id
    $("graphStatus").textContent = "running"
    showToast("Workflow started")
  }

  async function stopRun() {
    if (!state.activeRunId) return
    await fetch(`/api/runs/${encodeURIComponent(state.activeRunId)}/stop`, { method: "POST" })
    showToast("Stop requested")
  }

  function updateFromServer(serverState) {
    state.endpoints = serverState.endpoints || []
    state.events = serverState.events || []
    const runs = serverState.runs || []

    if (state.activeRunId && !runs.some((run) => run.id === state.activeRunId)) {
      state.activeRunId = null
    }
    if (!state.activeRunId) {
      const active = runs.find((run) => run.status === "running" || run.status === "queued")
      if (active) state.activeRunId = active.id
    }

    renderEndpoints()
    seedFromEndpoints()
    updateRunMetrics(runs)
    renderRecentEvents()
    renderNodes()
    renderInspector()
  }

  function activeRun(runs) {
    const source = runs || window.__unionRuns || []
    return source.find((run) => run.id === state.activeRunId)
  }

  function updateRunMetrics(runs) {
    if (runs) window.__unionRuns = runs
    const run = activeRun(runs)
    if (!run) {
      $("metricStatus").textContent = "Idle"
      $("metricVersion").textContent = "v0"
      $("metricLoop").textContent = "—"
      $("metricChars").textContent = "0 chars"
      $("runBadge").textContent = "idle"
      return
    }

    $("metricStatus").textContent = capitalize(run.status)
    $("metricVersion").textContent = `v${run.stateVersion || 0}`
    $("metricLoop").textContent = run.currentCycle
      ? `${run.currentCycle} / ${run.currentTurn || "—"}`
      : "—"
    $("metricChars").textContent = `${Number(run.chars || 0).toLocaleString()} chars`
    $("runBadge").textContent = run.status
    $("graphStatus").textContent = run.status

    if (["completed", "failed", "stopped"].includes(run.status)) {
      state.activeNodeId = null
      state.activeModuleId = null
    }
  }

  function renderRecentEvents() {
    const list = $("activityList")
    const events = [...state.events].slice(0, 14)
    list.innerHTML = events.map((event) => {
      const action = event.payload?.action || event.type
      return `<div class="activity-item"><b>${age(event.createdAt)}</b><span>${escapeHtml(formatAction(action, event.payload))}</span></div>`
    }).join("")
  }

  function handleEvent(event) {
    const payload = event.payload || {}
    const action = payload.action || event.type

    if (action === "workflow.node.started") {
      state.activeNodeId = payload.nodeId
      appendActivity(event)
      renderNodes()
    } else if (action === "workflow.node.completed") {
      if (state.activeNodeId === payload.nodeId) state.activeNodeId = null
      appendActivity(event)
      renderNodes()
    } else if (action === "workflow.module.started") {
      state.activeModuleId = payload.moduleId
      appendActivity(event)
      renderNodes()
    } else if (action === "workflow.module.completed") {
      if (state.activeModuleId === payload.moduleId) state.activeModuleId = null
      appendActivity(event)
      renderNodes()
    } else if (action === "workflow.handshake") {
      appendActivity(event)
      showHandshakeEvent(payload)
    } else if (String(action).startsWith("workflow.run.")) {
      appendActivity(event)
    } else if (event.type === "endpoint.connected" || event.type === "endpoint.status") {
      appendActivity(event)
    }
  }

  function appendActivity(event) {
    state.events = [event, ...state.events].slice(0, 40)
    renderRecentEvents()
  }

  function showHandshakeEvent(payload) {
    let from = payload.sourceNodeId
    let to = payload.targetNodeId
    const edge = state.edges.find((item) => item.from === from && item.to === to)
    if (edge) {
      edge.active = true
      renderEdges()
      setTimeout(() => {
        edge.active = false
        renderEdges()
      }, 1400)
      flashHandshake(from, to, payload.aligned ? "Context aligned" : "Context mismatch")
      return
    }

    const moduleNode = state.nodes.find((node) =>
      node.kind === "module" &&
      (String(from).startsWith(`${node.id}:`) || String(to).startsWith(`${node.id}:`))
    )
    if (moduleNode) {
      flashHandshake(moduleNode.id, moduleNode.id, payload.aligned ? "Internal loop aligned" : "Internal mismatch")
    }
  }

  function flashHandshake(from, to, message) {
    const source = state.nodes.find((node) => node.id === from)
    const target = state.nodes.find((node) => node.id === to)
    handshakeText.textContent = source && target && source.id !== target.id
      ? `${source.label} → ${target.label}: ${message}`
      : `${source?.label || "Module"}: ${message}`

    const a = portPoint(from, "out") || portPoint(from, "in") || { x: 240, y: 100 }
    const b = portPoint(to, "in") || a
    handshakeToast.style.left = `${Math.max(10, Math.min(surface.clientWidth - 330, (a.x + b.x) / 2 - 110))}px`
    handshakeToast.style.top = `${Math.max(15, Math.min(surface.clientHeight - 80, (a.y + b.y) / 2 - 18))}px`
    handshakeToast.classList.add("show")
    clearTimeout(flashHandshake.timer)
    flashHandshake.timer = setTimeout(() => handshakeToast.classList.remove("show"), 2200)
  }

  function connectSocket() {
    clearTimeout(socketRetry)
    const protocol = location.protocol === "https:" ? "wss:" : "ws:"
    socket = new WebSocket(`${protocol}//${location.host}/ws`)

    socket.addEventListener("open", () => {
      $("connectionPill").innerHTML = '<span class="live-dot"></span>Dashboard connected'
    })

    socket.addEventListener("message", (message) => {
      const packet = JSON.parse(message.data)
      if (packet.type === "state") updateFromServer(packet.data)
      if (packet.type === "event") handleEvent(packet.data)
    })

    socket.addEventListener("close", () => {
      $("connectionPill").textContent = "Reconnecting…"
      socketRetry = setTimeout(connectSocket, 1000)
    })
  }

  async function initialState() {
    const response = await fetch("/api/state")
    updateFromServer(await response.json())
  }

  nodesLayer.addEventListener("pointerdown", (event) => {
    const out = event.target.closest(".port.out")
    if (out) {
      event.preventDefault()
      event.stopPropagation()
      const node = out.closest(".node")
      const start = portPoint(node.dataset.id, "out")
      if (!start) return
      wire = { from: node.dataset.id, start }
      draftPath = svgPath("draft-edge", `M ${start.x} ${start.y} L ${start.x} ${start.y}`)
      edgeLayer.appendChild(draftPath)
      return
    }

    const nodeEl = event.target.closest(".node")
    if (!nodeEl || event.target.closest(".port")) return
    const node = state.nodes.find((item) => item.id === nodeEl.dataset.id)
    if (!node) return

    state.selectedNodeId = node.id
    const nodeRect = nodeEl.getBoundingClientRect()
    drag = {
      id: node.id,
      dx: event.clientX - nodeRect.left,
      dy: event.clientY - nodeRect.top,
    }
    nodeEl.classList.add("dragging")
    renderInspector()
    renderNodes()
  })

  window.addEventListener("pointermove", (event) => {
    if (drag) {
      const node = state.nodes.find((item) => item.id === drag.id)
      if (node) {
        const root = surface.getBoundingClientRect()
        node.x = clamp(event.clientX - root.left - drag.dx, 8, surface.clientWidth - 194)
        node.y = clamp(event.clientY - root.top - drag.dy, 8, surface.clientHeight - 95)
        const el = nodesLayer.querySelector(`.node[data-id="${CSS.escape(node.id)}"]`)
        if (el) {
          el.style.left = `${node.x}px`
          el.style.top = `${node.y}px`
        }
        renderEdges()
      }
    }

    if (wire && draftPath) {
      const root = surface.getBoundingClientRect()
      const end = { x: event.clientX - root.left, y: event.clientY - root.top }
      draftPath.setAttribute("d", pathD(wire.start, end))
    }
  })

  window.addEventListener("pointerup", (event) => {
    if (drag) {
      nodesLayer.querySelector(`.node[data-id="${CSS.escape(drag.id)}"]`)?.classList.remove("dragging")
      saveGraph()
      drag = null
    }

    if (wire) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".port.in")
      if (target) addEdge(wire.from, target.closest(".node").dataset.id)
      draftPath?.remove()
      draftPath = null
      wire = null
    }
  })

  nodesLayer.addEventListener("click", (event) => {
    const node = event.target.closest(".node")
    if (!node) return
    state.selectedNodeId = node.dataset.id
    renderNodes()
    renderInspector()
  })

  $("fieldLabel").addEventListener("input", (event) => {
    const node = selectedNode()
    if (!node) return
    node.label = event.target.value
    saveGraph()
    renderNodes()
    $("inspectLabel").textContent = node.label
  })

  $("fieldEndpoint").addEventListener("change", (event) => {
    const node = selectedNode()
    if (!node || node.kind !== "agent") return
    node.endpointId = event.target.value
    saveGraph()
    renderNodes()
  })

  $("fieldRole").addEventListener("input", (event) => {
    const node = selectedNode()
    if (!node || node.kind !== "agent") return
    node.role = event.target.value
    saveGraph()
    renderNodes()
  })

  $("fieldInstructions").addEventListener("input", (event) => {
    const node = selectedNode()
    if (!node || node.kind !== "agent") return
    node.instructions = event.target.value
    saveGraph()
  })

  $("fieldOutputSchema").addEventListener("input", (event) => {
    const node = selectedNode()
    if (!node || node.kind !== "agent") return
    node.outputSchema = event.target.value
    saveGraph()
  })

  $("moduleAgentA").addEventListener("change", (event) => {
    const node = selectedNode()
    if (!node || node.kind !== "module") return
    node.agentA = event.target.value
    saveGraph()
  })

  $("moduleAgentB").addEventListener("change", (event) => {
    const node = selectedNode()
    if (!node || node.kind !== "module") return
    node.agentB = event.target.value
    saveGraph()
  })

  $("moduleTurns").addEventListener("input", (event) => {
    const node = selectedNode()
    if (!node || node.kind !== "module") return
    node.turns = Math.max(2, Number(event.target.value || 2))
    saveGraph()
    renderNodes()
  })

  $("contextMode").addEventListener("change", (event) => {
    const node = selectedNode()
    if (!node || node.kind !== "context") return
    node.contextMode = event.target.value
    saveGraph()
    renderNodes()
  })

  $("rootCycles").addEventListener("input", (event) => {
    state.rootCycles = Math.max(1, Number(event.target.value || 1))
    saveGraph()
  })

  $("addLoopBtn").addEventListener("click", addPairLoop)
  $("addContextBtn").addEventListener("click", addContext)
  $("deleteNodeBtn").addEventListener("click", deleteSelectedNode)
  $("runBtn").addEventListener("click", () => void runWorkflow())
  $("stopBtn").addEventListener("click", () => void stopRun())
  $("saveBtn").addEventListener("click", () => saveGraph(false))
  $("clearBtn").addEventListener("click", () => {
    state.nodes = baseNodes()
    state.edges = []
    state.selectedNodeId = null
    state.seeded = true
    saveGraph()
    renderAll()
    showToast("Graph cleared")
  })

  window.addEventListener("resize", renderEdges)

  function formatAction(action, payload = {}) {
    const map = {
      "workflow.run.started": "Workflow run started",
      "workflow.run.completed": "Workflow completed",
      "workflow.run.failed": `Workflow failed: ${payload.error || ""}`,
      "workflow.run.stopped": "Workflow stopped",
      "workflow.module.started": `Module started: ${payload.moduleId || ""}`,
      "workflow.module.completed": `Module completed: ${payload.moduleId || ""}`,
      "workflow.node.started": `Running ${payload.label || payload.nodeId || "node"}`,
      "workflow.node.completed": `Completed ${payload.label || payload.nodeId || "node"}`,
      "workflow.handshake": payload.aligned ? "Context handshake aligned" : "Context handshake failed",
      "dashboard.started": "HTML control plane online",
    }
    return map[action] || String(action).replaceAll(".", " ")
  }

  function age(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || Date.now())) / 1000))
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    return `${Math.floor(minutes / 60)}h ago`
  }

  function capitalize(value) {
    return String(value || "").replace(/^./, (char) => char.toUpperCase())
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }

  function escapeAttr(value) {
    return escapeHtml(value)
  }

  loadGraph()
  renderAll()
  void initialState()
  connectSocket()
})()
