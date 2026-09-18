(() => {
  if (window.__UNION_DEEPSEEK_BRIDGE__) return
  window.__UNION_DEEPSEEK_BRIDGE__ = true

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  function title() {
    const value = document.title
      .replace(/\s*[-|]\s*DeepSeek.*$/i, "")
      .replace(/^DeepSeek\s*[-|]?\s*/i, "")
      .trim()
    return value && value !== "DeepSeek" ? value : "DeepSeek Conversation"
  }

  function composer() {
    return (
      document.querySelector("#chat-input") ||
      document.querySelector('textarea[data-testid="chat-input"]') ||
      document.querySelector('textarea[placeholder*="Send a message"]') ||
      document.querySelector('textarea[placeholder*="DeepSeek"]') ||
      document.querySelector("textarea") ||
      document.querySelector('div[contenteditable="true"][role="textbox"]')
    )
  }

  const THINK_SELECTOR = '.ds-think-content, [class*="think-content" i], [class*="thinking" i], [class*="reasoning" i]'

  function isThinkingNode(node) {
    return Boolean(node?.closest?.(THINK_SELECTOR))
  }

  function finalAnswerNode(root) {
    if (!root) return null

    const main = root.querySelector?.(".ds-assistant-message-main-content")
    if (main && !isThinkingNode(main)) {
      // Some builds put the final answer directly on this element; others put
      // a .ds-markdown below it. Prefer the deepest non-thinking markdown.
      const nested = [...main.querySelectorAll?.(".ds-markdown, [class*='markdown-body']") || []]
        .filter((node) => !isThinkingNode(node))
      return nested.at(-1) || main
    }

    const markdowns = [
      ...root.querySelectorAll?.(".ds-markdown, [class*='markdown-body']") || []
    ].filter((node) => !isThinkingNode(node))

    return markdowns.at(-1) || null
  }

  function latestAssistantTurn() {
    const messages = [...document.querySelectorAll(".ds-message, [class*='ds-message']")]
      .filter((node) =>
        node.querySelector?.(".ds-assistant-message-main-content, .ds-think-content, .ds-markdown")
      )
    return messages.at(-1) || null
  }

  const GENERATING_GRACE_MS = 30_000
  const STREAMING_IDLE_MS = 5_000
  let lastGeneratingSeenAt = 0
  let lastAssistantSig = null
  let lastAssistantSigAt = 0

  function isGenerating() {
    const selectors = [
      ".ds-icon-stop-circle",
      ".ds-icon-stop",
      'div[role="button"] svg path[d*="M3 3h10v10H3z"]',
      'div[role="button"] svg path[d*="M6 6h12v12H6z"]',
      'div[role="button"] svg path[d*="M2 4.88"]',
      'div[role="button"][aria-label*="Stop" i]',
      'button[aria-label*="Stop" i]',
      'button[data-testid*="stop" i]'
    ]

    if (selectors.some((selector) => document.querySelector(selector))) {
      lastGeneratingSeenAt = Date.now()
      return true
    }

    const latest = latestAssistantTurn()
    if (!latest) return false

    if (latest.querySelector(".ds-cursor") || latest.classList.contains("_streaming")) {
      lastGeneratingSeenAt = Date.now()
      return true
    }

    // Once DeepSeek mounts its action controls, the assistant turn is complete.
    if (latest.querySelector(
      'div[role="button"] svg, .ds-icon-copy, .ds-icon-regenerate, .ds-icon-share'
    )) {
      return false
    }

    const editor = composer()
    const editorText = editor
      ? ("value" in editor ? editor.value : editor.textContent || "")
      : ""

    // DeepSeek can hide the stop control while the composer contains text.
    // Only trust the message-level fallback if generation was observed recently.
    if (!String(editorText).trim() || Date.now() - lastGeneratingSeenAt > GENERATING_GRACE_MS) {
      const answer = textOf(finalAnswerNode(latest))
      if (latest.querySelector(THINK_SELECTOR) && !answer) return true
      return false
    }

    const text = latest.textContent || ""
    const sig = `${text.length}:${text.slice(-64)}`

    if (lastAssistantSig === null) {
      lastAssistantSig = sig
      return false
    }

    if (sig !== lastAssistantSig) {
      lastAssistantSig = sig
      lastAssistantSigAt = Date.now()
      lastGeneratingSeenAt = Date.now()
      return true
    }

    return Date.now() - lastAssistantSigAt <= STREAMING_IDLE_MS
  }

  function textOf(node) {
    return (node?.innerText || node?.textContent || "").trim()
  }

  function dedupeDeepest(nodes) {
    return nodes.filter((node, index) => {
      return !nodes.some((other, otherIndex) =>
        otherIndex !== index &&
        node !== other &&
        node.contains(other) &&
        textOf(other) === textOf(node)
      )
    })
  }

  function taggedMessages() {
    const nodes = [...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')]
    if (!nodes.length) return []
    return nodes
      .map((node, index) => {
        const role = node.getAttribute("data-message-author-role")
        const contentNode = role === "assistant" ? finalAnswerNode(node) : node
        return {
          role,
          content: textOf(contentNode),
          index
        }
      })
      .filter((message) =>
        (message.role === "user" || message.role === "assistant") &&
        message.content
      )
      .slice(-20)
  }

  function fallbackMessages() {
    const userNodes = dedupeDeepest([
      ...document.querySelectorAll(
        '.user-message, [class*="UserMessage"], [data-testid="user-message"]'
      )
    ])

    const assistantNodes = dedupeDeepest([
      ...document.querySelectorAll(
        '.ds-assistant-message-main-content, .ds-markdown, [class*="AssistantMessage"], [class*="markdown-body"]'
      )
    ]).filter((node) => !isThinkingNode(node))

    const rows = [
      ...userNodes.map((node) => ({ node, role: "user" })),
      ...assistantNodes.map((node) => ({ node, role: "assistant" }))
    ]

    rows.sort((a, b) => {
      if (a.node === b.node) return 0
      const position = a.node.compareDocumentPosition(b.node)
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1
      return 0
    })

    return rows
      .map((row, index) => ({
        role: row.role,
        content: textOf(row.node),
        index
      }))
      .filter((message) => message.content)
      .slice(-20)
  }

  function threadMessages() {
    const tagged = taggedMessages()
    return tagged.length ? tagged : fallbackMessages()
  }

  function threadSnapshot() {
    return {
      title: title(),
      url: location.href,
      generating: isGenerating(),
      messages: threadMessages()
    }
  }

  async function injectText(content) {
    const el = composer()
    if (!el) throw new Error("DeepSeek composer not found")
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

    throw new Error("Unsupported DeepSeek composer type")
  }

  function visible(element) {
    if (!element) return false
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
  }

  async function submit() {
    const selectors = [
      'button[aria-label="Send message"]',
      'button[aria-label*="Send" i]',
      '[data-testid="send-button"]',
      'button[type="submit"]',
      'div[class*="send" i][role="button"]'
    ]

    for (let attempt = 0; attempt < 12; attempt++) {
      for (const selector of selectors) {
        const candidate = [...document.querySelectorAll(selector)].find((element) =>
          visible(element) &&
          element.getAttribute("aria-disabled") !== "true" &&
          !element.disabled
        )
        if (candidate) {
          candidate.click()
          return
        }
      }
      await sleep(50)
    }

    const el = composer()
    if (!el) throw new Error("DeepSeek send control not found")
    el.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }))
    el.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }))
  }

  function endpoint() {
    return {
      adapterId: "deepseek-browser",
      system: "DeepSeek",
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

  let lastThreadSignature = ""
  let threadTimer

  function scheduleThreadUpdate(delay = 180) {
    clearTimeout(threadTimer)
    threadTimer = setTimeout(() => {
      const snapshot = threadSnapshot()
      const last = snapshot.messages.at(-1)
      const previous = snapshot.messages.at(-2)
      const signature = [
        snapshot.generating ? "1" : "0",
        snapshot.messages.length,
        previous?.role || "",
        previous?.content || "",
        last?.role || "",
        last?.content || ""
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
        const latest = [...threadMessages()].reverse().find((item) => item.role === "assistant")
        return { title: title(), content: latest?.content || "", url: location.href }
      }
      if (message.action === "read_thread") return threadSnapshot()
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

  setInterval(() => {
    announce()
    scheduleThreadUpdate(0)
  }, 2000)
})()
