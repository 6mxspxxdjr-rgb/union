const PORT = 7331
const endpoints = new Map()
let socket
let reconnectTimer
let heartbeatTimer

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function endpointPrefix(adapterId) {
  if (adapterId === "deepseek-browser") return "deepseek"
  return "chatgpt"
}

function endpointRecordForTab(tabId) {
  for (const [endpointId, record] of endpoints) {
    if (record.tabId === tabId) return { endpointId, record }
  }
}

async function rehydrateTabs() {
  let tabs = []
  try {
    tabs = await chrome.tabs.query({
      url: ["https://chatgpt.com/*", "https://chat.deepseek.com/*"]
    })
  } catch {
    return
  }

  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue
    const file = tab.url.startsWith("https://chat.deepseek.com/")
      ? "deepseek.js"
      : tab.url.startsWith("https://chatgpt.com/")
        ? "content.js"
        : null
    if (!file) continue

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [file]
      })
    } catch {
      // Restricted pages or tabs mid-navigation will be handled by normal
      // manifest content-script injection once they finish loading.
    }
  }
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
    send({ type: "response", requestId: request.requestId, ok: false, error: "AI tab is no longer registered" })
    return
  }

  try {
    const result = await chrome.tabs.sendMessage(record.tabId, {
      type: "union.request",
      action: request.action,
      payload: request.payload || {}
    })
    if (!result?.ok) throw new Error(result?.error || "Browser content adapter failed")
    send({ type: "response", requestId: request.requestId, ok: true, data: result.data })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Chrome keeps tabs alive across extension reloads, but the old content
    // script instance can disappear. If the background still has a record for
    // that tab, treat this specific messaging failure as a dead endpoint and
    // retire it immediately so callers do not repeatedly select a ghost tab.
    if (/receiving end does not exist|could not establish connection/i.test(message)) {
      endpoints.delete(request.endpointId)
      send({
        type: "endpoint.status",
        endpointId: request.endpointId,
        status: "offline"
      })
    }

    send({
      type: "response",
      requestId: request.requestId,
      ok: false,
      error: message
    })
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.id) return
  const tabId = sender.tab.id

  if (message?.type === "endpoint.upsert" && message.endpoint) {
    const adapterId = message.endpoint.adapterId || "chatgpt-browser"
    const endpointId = `${endpointPrefix(adapterId)}_tab_${tabId}`

    const previous = endpointRecordForTab(tabId)
    if (previous && previous.endpointId !== endpointId) endpoints.delete(previous.endpointId)

    const endpoint = {
      ...message.endpoint,
      id: endpointId,
      adapterId,
      externalId: String(tabId),
      updatedAt: Date.now()
    }
    endpoints.set(endpointId, { tabId, endpoint })
    send({ type: "endpoint.upsert", endpoint })
    return
  }

  if (message?.type === "thread.updated" && message.snapshot) {
    const found = endpointRecordForTab(tabId)
    if (!found) return
    const { endpointId, record } = found

    record.endpoint = {
      ...record.endpoint,
      title: message.snapshot.title || record.endpoint.title,
      url: message.snapshot.url || record.endpoint.url,
      status: message.snapshot.generating ? "working" : "waiting",
      updatedAt: Date.now()
    }
    send({ type: "endpoint.upsert", endpoint: record.endpoint })

    send({
      type: "thread.updated",
      endpointId,
      snapshot: message.snapshot
    })
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  const found = endpointRecordForTab(tabId)
  if (!found) return
  endpoints.delete(found.endpointId)
  send({ type: "endpoint.status", endpointId: found.endpointId, status: "offline" })
})

void rehydrateTabs()
connect()
