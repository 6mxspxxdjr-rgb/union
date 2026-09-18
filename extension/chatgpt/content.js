(() => {
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

  function latestAssistant() {
    const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')]
    const latest = messages.at(-1)
    if (!latest) return ""
    const markdown = latest.querySelector(".markdown") || latest
    return (markdown.innerText || markdown.textContent || "").trim()
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "union.request") return

    ;(async () => {
      if (message.action === "read_latest") {
        return { title: title(), content: latestAssistant(), url: location.href }
      }
      if (message.action === "inject") {
        await injectText(String(message.payload?.content || ""))
        if (message.payload?.submit) await submit()
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
  setInterval(announce, 2000)
})()
