(() => {
  if (window.__UNION_CHATGPT_BRIDGE__) return
  window.__UNION_CHATGPT_BRIDGE__ = true

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  function title() {
    const value = document.title
      .replace(/\s*[-|]\s*ChatGPT.*$/i, "")
      .replace(/^ChatGPT\s*[-|]?\s*/i, "")
      .trim()
    return value && value !== "ChatGPT" ? value : "ChatGPT Conversation"
  }

  function isGenerating() {
    return Boolean(
      document.querySelector('button[data-testid="stop-button"]') ||
      [...document.querySelectorAll("button")].some((button) => /stop generating|stop/i.test(button.getAttribute("aria-label") || ""))
    )
  }

  function messageText(node, role) {
    const body =
      role === "assistant"
        ? node.querySelector(".markdown") || node
        : node.querySelector(".whitespace-pre-wrap") ||
          node.querySelector('[class*="whitespace-pre-wrap"]') ||
          node
    return (body.innerText || body.textContent || "").trim()
  }

  function threadMessages() {
    return [...document.querySelectorAll("[data-message-author-role]")]
      .map((node, index) => {
        const role = node.getAttribute("data-message-author-role")
        if (role !== "user" && role !== "assistant") return null
        const content = messageText(node, role)
        if (!content) return null
        return { role, content, index }
      })
      .filter(Boolean)
      .slice(-20)
  }

  function latestAssistantMessage() {
    const nodes = [...document.querySelectorAll("[data-message-author-role]")]
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index]
      if (node.getAttribute("data-message-author-role") !== "assistant") continue
      const content = messageText(node, "assistant")
      if (!content) return null
      return { role: "assistant", content, index }
    }
    return null
  }

  function latestAssistant() {
    return latestAssistantMessage()?.content || ""
  }

  function composer() {
    return (
      document.querySelector("#prompt-textarea") ||
      document.querySelector('textarea[data-id="root"]') ||
      document.querySelector("textarea")
    )
  }

  async function injectText(content) {
    const el = composer()
    if (!el) throw new Error("ChatGPT composer not found")
    el.focus()

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set
      if (setter) setter.call(el, content)
      else el.value = content
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      return
    }

    if (el.isContentEditable) {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.execCommand("insertText", false, content)
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: content }))
      return
    }

    throw new Error("Unsupported ChatGPT composer type")
  }

  async function submit() {
    for (let i = 0; i < 20; i++) {
      const button =
        document.querySelector('button[data-testid="send-button"]') ||
        [...document.querySelectorAll("button")].find((candidate) => /send/i.test(candidate.getAttribute("aria-label") || ""))
      if (button && !button.disabled) {
        button.click()
        return
      }
      await sleep(50)
    }
    throw new Error("ChatGPT send button not available")
  }

  function endpoint() {
    return {
      system: "ChatGPT",
      title: title(),
      status: isGenerating() ? "working" : "waiting",
      capabilities: ["discover", "read", "send", "submit", "stream"],
      url: location.href,
      metadata: { pathname: location.pathname }
    }
  }

  function announce() {
    void chrome.runtime.sendMessage({ type: "endpoint.upsert", endpoint: endpoint() }).catch(() => {})
  }

  function threadSnapshot() {
    return {
      title: title(),
      url: location.href,
      generating: isGenerating(),
      messages: threadMessages()
    }
  }

  // Push only generation state while streaming, then the completed latest
  // assistant answer once. Full history remains available through read_thread.
  function relaySnapshot() {
    const generating = isGenerating()
    const latest = generating ? null : latestAssistantMessage()
    return {
      title: title(),
      url: location.href,
      generating,
      messages: latest ? [latest] : []
    }
  }

  let lastThreadSignature = ""
  let threadTimer

  function scheduleThreadUpdate(delay = 180) {
    clearTimeout(threadTimer)
    threadTimer = setTimeout(() => {
      const snapshot = relaySnapshot()
      const last = snapshot.messages.at(-1)
      const content = last?.content || ""
      const signature = [
        snapshot.generating ? "1" : "0",
        last?.index ?? -1,
        content.length,
        content.slice(-96)
      ].join("\u001f")

      if (signature === lastThreadSignature) return
      lastThreadSignature = signature
      void chrome.runtime.sendMessage({ type: "thread.updated", snapshot }).catch(() => {})
    }, delay)
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "union.request") return

    ;(async () => {
      if (message.action === "read_latest") {
        return { title: title(), content: latestAssistant(), url: location.href, generating: isGenerating() }
      }
      if (message.action === "read_thread") {
        return threadSnapshot()
      }
      if (message.action === "inject") {
        await injectText(String(message.payload?.content || ""))
        if (message.payload?.submit) {
          await submit()
          scheduleThreadUpdate(40)
        }
        return { ok: true }
      }
      if (message.action === "inspect") return endpoint()
      throw new Error(`Unknown action: ${message.action}`)
    })()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))

    return true
  })

  announce()
  scheduleThreadUpdate(0)

  const observer = new MutationObserver(() => scheduleThreadUpdate())
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true
  })

  // Status/title fallback in case ChatGPT changes DOM structures without
  // producing a message mutation that matters to Union.
  setInterval(() => {
    announce()
    scheduleThreadUpdate(0)
  }, 2000)
})()
