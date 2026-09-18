const PORT = 7331
const endpoints = new Map()
let socket
let reconnectTimer
let heartbeatTimer

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function connect() {
  clearTimeout(reconnectTimer)
  clearInterval(heartbeatTimer)

  socket = new WebSocket(`ws://127.0.0.1:${PORT}`)

  socket.addEventListener("open", () => {
    for (const { endpoint } of endpoints.values()) send({ type: "endpoint.upsert", endpoint })
    heartbeatTimer = setInterval(() => send({ type: "keepalive", at: Date.now() }), 20_000)
  })

  socket.addEventListener("message", (event) => {
    let request
    try { request = JSON.parse(event.data) } catch { return }
    if (request.type !== "request" || !request.requestId || !request.endpointId) return
    void handleRequest(request)
  })

  socket.addEventListener("close", () => {
    clearInterval(heartbeatTimer)
    reconnectTimer = setTimeout(connect, 1200)
  })

  socket.addEventListener("error", () => socket.close())
}

async function handleRequest(request) {
  const record = endpoints.get(request.endpointId)
  if (!record) {
    send({ type: "response", requestId: request.requestId, ok: false, error: "ChatGPT tab is no longer registered" })
    return
  }

  try {
    const result = await chrome.tabs.sendMessage(record.tabId, {
      type: "union.request",
      action: request.action,
      payload: request.payload || {}
    })
    if (!result?.ok) throw new Error(result?.error || "ChatGPT content adapter failed")
    send({ type: "response", requestId: request.requestId, ok: true, data: result.data })
  } catch (error) {
    send({
      type: "response",
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.id) return
  const tabId = sender.tab.id
  const endpointId = `chatgpt_tab_${tabId}`

  if (message?.type === "endpoint.upsert" && message.endpoint) {
    const endpoint = {
      ...message.endpoint,
      id: endpointId,
      adapterId: "chatgpt-browser",
      externalId: String(tabId),
      updatedAt: Date.now()
    }
    endpoints.set(endpointId, { tabId, endpoint })
    send({ type: "endpoint.upsert", endpoint })
    return
  }

  if (message?.type === "thread.updated" && message.snapshot) {
    const existing = endpoints.get(endpointId)
    if (existing) {
      existing.endpoint = {
        ...existing.endpoint,
        title: message.snapshot.title || existing.endpoint.title,
        url: message.snapshot.url || existing.endpoint.url,
        status: message.snapshot.generating ? "working" : "waiting",
        updatedAt: Date.now()
      }
      send({ type: "endpoint.upsert", endpoint: existing.endpoint })
    }

    send({
      type: "thread.updated",
      endpointId,
      snapshot: message.snapshot
    })
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  const endpointId = `chatgpt_tab_${tabId}`
  if (!endpoints.has(endpointId)) return
  endpoints.delete(endpointId)
  send({ type: "endpoint.status", endpointId, status: "offline" })
})

connect()
