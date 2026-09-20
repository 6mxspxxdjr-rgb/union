import type { InputRenderable } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useKeyboard, usePaste, useRenderer } from "@opentui/solid"
import type { RoomTurn, UnionRuntime } from "../core/runtime"
import type { Endpoint, FileRecord } from "../core/types"

type Lens = "subjects" | "files" | "agents" | "activity" | "room" | "chat"
type Focus = "subjects" | "files" | "agents"

const STATUS: Record<string, string> = {
  working: "●",
  waiting: "◌",
  needs_you: "◆",
  done: "✓",
  failed: "!",
  paused: "∥",
  offline: "×",
}

const STATUS_LABEL: Record<string, string> = {
  working: "WORKING",
  waiting: "WAITING",
  needs_you: "NEEDS YOU",
  done: "DONE",
  failed: "FAILED",
  paused: "PAUSED",
  offline: "OFFLINE",
}

function age(ts: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function eventLabel(event: any) {
  const action = String(event.payload?.action || "")
  if (action === "scan.started") return "Indexing workspace"
  if (action === "scan.completed") return `Indexed ${event.payload?.count ?? 0} files`
  if (action === "scan.progress") return `Indexing ${event.payload?.indexed ?? 0}/${event.payload?.total ?? 0}`
  if (event.type === "endpoint.connected") return `${event.payload?.system || "AI"} connected`
  if (event.type === "endpoint.status") return `${event.payload?.title || "AI"} · ${event.payload?.status || ""}`
  if (event.type === "message.received") return `Captured AI reply · ${event.payload?.chars || 0} chars`
  if (event.type === "message.sent") return `${event.payload?.submit ? "Sent" : "Injected"} context · ${event.payload?.chars || 0} chars`
  if (event.type === "context.compiled") return `Compiled context · ${event.payload?.items || 0} items`
  if (event.type === "file.changed") return `Changed · ${event.payload?.title || "file"}`
  if (event.type === "file.indexed") return `Indexed · ${event.payload?.title || "file"}`
  return event.type
}

export function App(props: { runtime: UnionRuntime }) {
  const renderer = useRenderer()
  const [tick, setTick] = createSignal(0)
  const [lens, setLens] = createSignal<Lens>("subjects")
  const [focus, setFocus] = createSignal<Focus>("subjects")
  const [subjectIndex, setSubjectIndex] = createSignal(0)
  const [fileIndex, setFileIndex] = createSignal(0)
  const [agentIndex, setAgentIndex] = createSignal(0)
  const [chatEndpointId, setChatEndpointId] = createSignal<string>()
  const [roomTurns, setRoomTurns] = createSignal<RoomTurn[]>([])
  const [roomTurnLimit, setRoomTurnLimit] = createSignal(4)
  const [roomRunning, setRoomRunning] = createSignal(false)
  const [roomStatus, setRoomStatus] = createSignal("ready")
  const [notice, setNotice] = createSignal("ready")
  const [capture, setCapture] = createSignal("")
  const [captureSource, setCaptureSource] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  let userPickedSubject = false
  let chatInput: InputRenderable | null = null
  let roomInput: InputRenderable | null = null

  const offEvent = props.runtime.events.on(() => setTick((v) => v + 1))
  const offThread = props.runtime.onThreadUpdate(() => setTick((v) => v + 1))
  const clock = setInterval(() => setTick((v) => v + 1), 15_000)

  // Push events are the primary response path. This slow poll is only a
  // resilience fallback if ChatGPT changes DOM behavior and a mutation is missed.
  const chatPoll = setInterval(() => {
    if (lens() !== "chat") return
    const endpoint = chatEndpoint()
    if (!endpoint) return
    void props.runtime.syncThread(endpoint)
      .then(() => setTick((v) => v + 1))
      .catch(() => {})
  }, 5000)

  onCleanup(() => {
    offEvent()
    offThread()
    clearInterval(clock)
    clearInterval(chatPoll)
  })

  usePaste((event) => {
    if (lens() === "chat") chatInput?.handlePaste(event)
    else if (lens() === "room") roomInput?.handlePaste(event)
  })

  const subjects = createMemo(() => {
    tick()
    return props.runtime.subjects()
  })

  createEffect(() => {
    const list = subjects()
    if (!list.length || userPickedSubject) return
    const active = list.findIndex((item) => item.active > 0)
    const union = list.findIndex((item) => item.title === "Union")
    const target = active >= 0 ? active : union >= 0 ? union : 0
    if (target !== subjectIndex()) setSubjectIndex(target)
  })

  createEffect(() => {
    if (lens() === "chat") setTimeout(() => chatInput?.focus(), 0)
    else if (lens() === "room" && !roomRunning()) setTimeout(() => roomInput?.focus(), 0)
  })

  const selectedSubject = createMemo(() =>
    subjects()[Math.min(subjectIndex(), Math.max(0, subjects().length - 1))]?.title
  )

  const allFiles = createMemo(() => {
    tick()
    return props.runtime.files()
  })

  const subjectFiles = createMemo(() => {
    tick()
    return props.runtime.files(selectedSubject())
  })

  const files = createMemo(() => lens() === "files" ? allFiles() : subjectFiles())

  const allAgents = createMemo(() => {
    tick()
    return props.runtime.endpoints()
  })

  const roomChatGPT = createMemo(() =>
    allAgents().find((endpoint) => endpoint.system === "ChatGPT" && endpoint.status !== "offline")
  )

  const roomDeepSeek = createMemo(() =>
    allAgents().find((endpoint) => endpoint.system === "DeepSeek" && endpoint.status !== "offline")
  )

  const subjectAgents = createMemo(() =>
    allAgents().filter((endpoint) => !selectedSubject() || endpoint.subject === selectedSubject())
  )

  const selectedFile = createMemo<FileRecord | undefined>(() =>
    files()[Math.min(fileIndex(), Math.max(0, files().length - 1))]
  )

  const selectedAgent = createMemo<Endpoint | undefined>(() =>
    allAgents()[Math.min(agentIndex(), Math.max(0, allAgents().length - 1))]
  )

  const chatEndpoint = createMemo<Endpoint | undefined>(() =>
    allAgents().find((endpoint) => endpoint.id === chatEndpointId()) || selectedAgent()
  )

  const chatMessages = createMemo(() => {
    tick()
    const endpoint = chatEndpoint()
    return endpoint ? props.runtime.db.messagesForEndpoint(endpoint.id, 20) : []
  })

  const context = createMemo(() =>
    props.runtime.icm.compile({
      subject: selectedSubject(),
      fileId: selectedFile()?.id,
      endpointId: selectedAgent()?.id,
    })
  )

  const preview = createMemo(() => props.runtime.preview(selectedFile()).split("\n").slice(0, 10))

  const events = createMemo(() => {
    tick()
    return props.runtime.db.recentEvents(30)
  })

  const subjectEvents = createMemo(() =>
    events().filter((event) => event.subject === selectedSubject()).slice(0, 8)
  )

  const topContextFiles = createMemo(() =>
    context().items.filter((item) => item.kind === "file").slice(0, 7)
  )

  function move(delta: number) {
    if (focus() === "subjects") {
      userPickedSubject = true
      setSubjectIndex((i) => Math.max(0, Math.min(subjects().length - 1, i + delta)))
      setFileIndex(0)
    } else if (focus() === "files") {
      setFileIndex((i) => Math.max(0, Math.min(files().length - 1, i + delta)))
    } else {
      setAgentIndex((i) => Math.max(0, Math.min(allAgents().length - 1, i + delta)))
    }
  }

  function cycleFocus() {
    if (lens() === "files") {
      setFocus((current) => current === "subjects" ? "files" : current === "files" ? "agents" : "subjects")
      return
    }
    setFocus((current) => current === "agents" ? "subjects" : "agents")
  }

  async function openChat() {
    const endpoint = selectedAgent()
    if (!endpoint) return setNotice("select an AI endpoint first")
    setChatEndpointId(endpoint.id)
    setLens("chat")
    setFocus("agents")
    setNotice(`chat · ${endpoint.title}`)
    await props.runtime.syncThread(endpoint).catch(() => {})
    setTick((v) => v + 1)
  }

  function closeChat() {
    chatInput?.blur()
    setLens("subjects")
    setFocus("agents")
    setNotice("returned home")
  }

  async function submitChat(value: string) {
    const endpoint = chatEndpoint()
    const text = value.trim()
    if (!endpoint || !text || busy()) return

    setBusy(true)
    setNotice(`sending → ${endpoint.title}`)
    try {
      await props.runtime.send(endpoint, text, true)
      if (chatInput) chatInput.value = ""
      await props.runtime.syncThread(endpoint).catch(() => {})
      setTick((v) => v + 1)
      setNotice(`sent · waiting for ${endpoint.system}`)
    } catch (error) {
      setNotice(String(error))
    } finally {
      setBusy(false)
      setTimeout(() => chatInput?.focus(), 0)
    }
  }

  async function runRoom(value: string) {
    const task = value.trim()
    const chatgpt = roomChatGPT()
    const deepseek = roomDeepSeek()
    if (!task || roomRunning()) return
    if (!chatgpt || !deepseek) {
      setNotice("Room needs one connected ChatGPT tab and one connected DeepSeek tab")
      return
    }

    const turnLimit = roomTurnLimit()
    setRoomTurns([])
    setRoomRunning(true)
    setRoomStatus(`turn 1/${turnLimit} · ChatGPT working`)
    setNotice("Room started · ChatGPT ↔ DeepSeek")

    try {
      if (roomInput) roomInput.value = ""
      await props.runtime.runTwoAgentRoom(task, chatgpt, deepseek, {
        turns: turnLimit,
        onTurn: (turn) => {
          setRoomTurns((current) => [...current, turn])
          const next = turn.index + 1
          setRoomStatus(
            next <= turnLimit
              ? `turn ${next}/${turnLimit} · ${next % 2 === 1 ? "ChatGPT" : "DeepSeek"} working`
              : `completed · ${turnLimit}/${turnLimit} turns`,
          )
          setTick((v) => v + 1)
        },
      })
      setRoomStatus(`completed · ${turnLimit}/${turnLimit} turns`)
      setNotice("Room completed")
    } catch (error) {
      setRoomStatus(`failed · ${String(error)}`)
      setNotice(String(error))
    } finally {
      setRoomRunning(false)
      setTimeout(() => roomInput?.focus(), 0)
    }
  }

  async function yank() {
    const endpoint = selectedAgent()
    if (!endpoint) return setNotice("select an AI endpoint first")
    setBusy(true)
    try {
      const messages = await props.runtime.readLatest(endpoint)
      const latest = messages.at(-1)
      if (!latest?.content) setNotice("no assistant reply found")
      else {
        setCapture(latest.content)
        setCaptureSource(`${endpoint.system} / ${endpoint.title}`)
        setNotice(`captured ${latest.content.length} chars`)
      }
    } catch (error) {
      setNotice(String(error))
    } finally {
      setBusy(false)
      setTick((v) => v + 1)
    }
  }

  function captureContext() {
    const pack = context()
    const materialized = props.runtime.icm.materialize(pack)
    setCapture(materialized)
    setCaptureSource(`ICM / ${selectedSubject() || "Workspace"}`)
    setNotice(`compiled ${pack.items.length} context items · ${materialized.length} chars`)
    props.runtime.events.emit(
      "context.compiled",
      { items: pack.items.length, chars: materialized.length },
      { subject: selectedSubject(), objectId: selectedFile()?.id },
    )
  }

  async function paste(submit: boolean) {
    const endpoint = selectedAgent()
    if (!endpoint) return setNotice("select a destination endpoint")
    if (!capture()) return setNotice("capture is empty; press y for AI or c for ICM")
    setBusy(true)
    try {
      await props.runtime.send(endpoint, capture(), submit)
      setNotice(`${submit ? "sent" : "injected"} → ${endpoint.title}`)
    } catch (error) {
      setNotice(String(error))
    } finally {
      setBusy(false)
      setTick((v) => v + 1)
    }
  }

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }

    if (lens() === "chat") {
      if (key.name === "escape") closeChat()
      return
    }

    if (lens() === "room") {
      if (!roomRunning() && (key.name === "[" || key.sequence === "[")) {
        key.preventDefault()
        key.stopPropagation()
        setRoomTurnLimit((current) => Math.max(2, current - 1))
        setRoomStatus("ready")
        return
      }
      if (!roomRunning() && (key.name === "]" || key.sequence === "]")) {
        key.preventDefault()
        key.stopPropagation()
        setRoomTurnLimit((current) => Math.min(12, current + 1))
        setRoomStatus("ready")
        return
      }
      if (key.name === "escape" && !roomRunning()) {
        roomInput?.blur()
        setLens("subjects")
        setFocus("agents")
        setNotice("returned home")
      }
      return
    }

    if (key.name === "q") renderer.destroy()
    else if (key.name === "h" || key.name === "1") { setLens("subjects"); setFocus("subjects") }
    else if (key.name === "f" || key.name === "2") { setLens("files"); setFocus("files") }
    else if (key.name === "s" || key.name === "3") { setLens("agents"); setFocus("agents") }
    else if (key.name === "a" || key.name === "4") { setLens("activity"); setFocus("subjects") }
    else if (key.name === "r" || key.name === "5") { setLens("room"); setFocus("agents") }
    else if (key.name === "tab") cycleFocus()
    else if (key.name === "return" && focus() === "agents") void openChat()
    else if (key.name === "j" || key.name === "down") move(1)
    else if (key.name === "k" || key.name === "up") move(-1)
    else if (key.name === "g") void props.runtime.rescan().then((n) => {
      setNotice(n ? `indexed ${n} files` : "scan already running")
      setTick((v) => v + 1)
    })
    else if (key.name === "o") {
      if (focus() === "agents" && selectedAgent()?.url) {
        props.runtime.openEndpoint(selectedAgent()!)
        setNotice(`opened ${selectedAgent()!.title} in browser`)
      } else if (lens() === "files" && selectedFile()) {
        props.runtime.revealFile(selectedFile()!)
        setNotice(`revealed ${selectedFile()!.title} in Finder`)
      }
    }
    else if (key.name === "y") void yank()
    else if (key.name === "c") captureContext()
    else if (key.name === "p") void paste(Boolean(key.shift))
  })

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#0b0d10">
      <box
        height={3}
        paddingLeft={2}
        paddingRight={2}
        justifyContent="space-between"
        alignItems="center"
        border={["bottom"]}
        borderColor="#30363d"
      >
        <text fg="#f0f6fc">
          <b>UNION</b> <span style={{ fg: "#58a6ff" }}>●</span>
          <span style={{ fg: "#8b949e" }}> AI workspace</span>
        </text>
        <text fg="#6e7681">{props.runtime.root}</text>
      </box>

      <box flexGrow={1} flexDirection="row">
        <box
            width={24}
            flexDirection="column"
            padding={1}
            border={["right"]}
            borderColor={focus() === "subjects" ? "#58a6ff" : "#30363d"}
          >
            <text fg="#8b949e"><b>NAVIGATE</b></text>
            <text fg={lens() === "subjects" ? "#f0f6fc" : "#6e7681"}>{lens() === "subjects" ? "›" : " "} H  Home</text>
            <text fg={lens() === "room" ? "#f0f6fc" : "#6e7681"}>{lens() === "room" ? "›" : " "} R  Room</text>
            <text fg={lens() === "files" ? "#f0f6fc" : "#6e7681"}>{lens() === "files" ? "›" : " "} F  Files</text>
            <text fg={lens() === "agents" || lens() === "chat" ? "#f0f6fc" : "#6e7681"}>{lens() === "agents" || lens() === "chat" ? "›" : " "} S  Chats</text>
            <text fg={lens() === "activity" ? "#f0f6fc" : "#6e7681"}>{lens() === "activity" ? "›" : " "} A  Activity</text>
            <text> </text>
            <text fg="#8b949e"><b>CONTEXT</b></text>
            <text fg="#6e7681">{subjects().length} subjects</text>
            <text> </text>
            <For each={subjects().slice(0, 26)}>{(subject, i) => (
              <text fg={i() === subjectIndex() ? "#f0f6fc" : "#8b949e"}>
                {i() === subjectIndex() ? "›" : " "} {subject.title.slice(0, 15).padEnd(15)}
                <span style={{ fg: subject.active ? "#58a6ff" : "#484f58" }}>
                  {subject.active ? ` ●${subject.active}` : ` ${subject.files}`}
                </span>
              </text>
            )}</For>
          </box>

        <box flexGrow={1} minWidth={48} flexDirection="column" padding={1} border={["right"]} borderColor="#30363d">
          <Show when={lens() === "subjects"}>
            <text fg="#f0f6fc"><b>{selectedSubject() || "Workspace"}</b></text>
            <text fg="#6e7681">CURRENT WORK</text>
            <text> </text>

            <Show when={subjectAgents().length} fallback={<text fg="#6e7681">No live AI work in this subject yet.</text>}>
              <For each={subjectAgents().slice(0, 6)}>{(agent) => (
                <box flexDirection="column" marginBottom={1}>
                  <text fg="#c9d1d9">
                    {STATUS[agent.status] || "·"} <b>{agent.title}</b>
                  </text>
                  <text fg="#6e7681">
                    {"  "}{agent.system} · {STATUS_LABEL[agent.status] || agent.status.toUpperCase()} · {age(agent.updatedAt)}
                  </text>
                </box>
              )}</For>
            </Show>

            <text> </text>
            <text fg="#58a6ff"><b>CONTEXT</b></text>
            <Show when={topContextFiles().length} fallback={<text fg="#6e7681">No relevant files indexed yet.</text>}>
              <For each={topContextFiles()}>{(item) => (
                <text fg="#8b949e">
                  {"  "}□ {item.title.slice(0, 36)}
                  <span style={{ fg: "#484f58" }}> · {item.reason}</span>
                </text>
              )}</For>
            </Show>

            <text> </text>
            <text fg="#58a6ff"><b>RECENT</b></text>
            <Show when={subjectEvents().length} fallback={<text fg="#6e7681">No subject activity yet.</text>}>
              <For each={subjectEvents().slice(0, 5)}>{(event) => (
                <text fg="#6e7681">{age(event.createdAt).padStart(4)}  {eventLabel(event).slice(0, 58)}</text>
              )}</For>
            </Show>
          </Show>

          <Show when={lens() === "files"}>
            <text fg="#f0f6fc"><b>FILES</b></text>
            <text fg="#6e7681">{allFiles().length} in this workspace · o reveals in Finder</text>
            <text> </text>
            <For each={files().slice(0, 16)}>{(file, i) => (
              <text fg={i() === fileIndex() ? "#f0f6fc" : "#8b949e"}>
                {i() === fileIndex() ? "›" : " "} {file.title.slice(0, 35).padEnd(36)}
                <span style={{ fg: "#484f58" }}>{(file.extension || "file").padEnd(6)} {age(file.modifiedAt)}</span>
              </text>
            )}</For>
            <Show when={selectedFile()}>
              <text> </text>
              <text fg="#58a6ff"><b>PREVIEW</b> <span style={{ fg: "#484f58" }}>{selectedFile()!.path}</span></text>
              <For each={preview()}>{(line) => <text fg="#8b949e">{line.slice(0, 74)}</text>}</For>
            </Show>
          </Show>

          <Show when={lens() === "agents"}>
            <text fg="#f0f6fc"><b>CHAT SESSION</b></text>
            <text fg="#6e7681">Enter chat · o open in browser</text>
            <text> </text>
            <Show when={selectedAgent()} fallback={<text fg="#6e7681">No AI endpoint selected.</text>}>
              {(agent) => (
                <box flexDirection="column">
                  <text fg="#c9d1d9">{STATUS[agent().status] || "·"} <b>{agent().title}</b></text>
                  <text fg="#8b949e">System   {agent().system}</text>
                  <text fg="#8b949e">Status   {STATUS_LABEL[agent().status] || agent().status}</text>
                  <text fg="#8b949e">Subject  {agent().subject || "Unsorted"}</text>
                  <text fg="#8b949e">Updated  {age(agent().updatedAt)} ago</text>
                  <text fg="#8b949e">URL      {(agent().url || "").slice(0, 64)}</text>
                  <text> </text>
                  <text fg="#58a6ff"><b>ACTIONS</b></text>
                  <text fg="#8b949e">Enter  chat with this session</text>
                  <text fg="#8b949e">y      capture latest response</text>
                  <text fg="#8b949e">p      inject current buffer</text>
                  <text fg="#8b949e">⇧p     inject + submit</text>
                  <text fg="#8b949e">c      compile selected subject context</text>
                </box>
              )}
            </Show>
          </Show>

          <Show when={lens() === "activity"}>
            <text fg="#f0f6fc"><b>ACTIVITY</b></text>
            <text fg="#6e7681">meaningful Union events</text>
            <text> </text>
            <For each={events().slice(0, 18)}>{(event) => (
              <text fg="#8b949e">
                {age(event.createdAt).padStart(4)}  <span style={{ fg: "#c9d1d9" }}>{eventLabel(event).slice(0, 64)}</span>
              </text>
            )}</For>
          </Show>

          <Show when={lens() === "room"}>
            <box flexDirection="column" flexGrow={1} minHeight={0}>
              <text fg="#f0f6fc"><b>ROOM</b> <span style={{ fg: "#8b949e" }}>ChatGPT ↔ DeepSeek</span></text>
              <text fg="#6e7681">
                {roomChatGPT() ? "● ChatGPT" : "× ChatGPT"}  {roomDeepSeek() ? "● DeepSeek" : "× DeepSeek"} · {roomTurnLimit()} turns · {roomStatus()}
              </text>
              <text> </text>

              <scrollbox
                flexGrow={1}
                flexShrink={1}
                stickyScroll={true}
                stickyStart="bottom"
                scrollbarOptions={{ visible: true }}
                contentOptions={{ flexGrow: 1, gap: 1 }}
              >
                <Show
                  when={roomTurns().length}
                  fallback={
                    <box flexDirection="column">
                      <text fg="#8b949e">Type one shared task below.</text>
                      <text fg="#6e7681">Union will carry the conversation between the connected agents automatically.</text>
                      <text fg="#6e7681">{roomTurnLimit()} responses · [ or ] changes the turn limit before starting.</text>
                    </box>
                  }
                >
                  <For each={roomTurns()}>{(turn) => (
                    <box
                      flexDirection="column"
                      paddingLeft={1}
                      paddingRight={1}
                      border={["left"]}
                      borderColor={turn.system === "ChatGPT" ? "#58a6ff" : "#a371f7"}
                    >
                      <text fg={turn.system === "ChatGPT" ? "#58a6ff" : "#a371f7"}>
                        <b>{turn.system.toUpperCase()}</b> <span style={{ fg: "#6e7681" }}>turn {turn.index}</span>
                      </text>
                      <text fg="#c9d1d9">{turn.content}</text>
                    </box>
                  )}</For>
                </Show>
              </scrollbox>

              <box
                height={3}
                marginTop={1}
                paddingLeft={1}
                paddingRight={1}
                border
                borderColor={roomRunning() ? "#d29922" : "#58a6ff"}
                alignItems="center"
              >
                <text fg="#58a6ff">› </text>
                <input
                  ref={(value) => (roomInput = value)}
                  focused={!roomRunning()}
                  flexGrow={1}
                  maxLength={8000}
                  placeholder={roomRunning() ? "room is working…" : "Give ChatGPT + DeepSeek one shared task…"}
                  onSubmit={(value) => void runRoom(typeof value === "string" ? value : roomInput?.value || "")}
                />
              </box>
            </box>
          </Show>

          <Show when={lens() === "chat"}>
            <box flexDirection="column" flexGrow={1} minHeight={0}>
              <text fg="#f0f6fc">
                <b>{chatEndpoint()?.title || chatEndpoint()?.system || "Chat"}</b>
                <span style={{ fg: "#8b949e" }}> · {chatEndpoint()?.system || "AI"}</span>
              </text>
              <text fg="#6e7681">
                {STATUS[chatEndpoint()?.status || "offline"] || "·"} {STATUS_LABEL[chatEndpoint()?.status || "offline"] || "OFFLINE"}
              </text>
              <text> </text>

              <scrollbox
                flexGrow={1}
                flexShrink={1}
                stickyScroll={true}
                stickyStart="bottom"
                scrollbarOptions={{ visible: true }}
                contentOptions={{ flexGrow: 1, gap: 1 }}
              >
                <Show when={chatMessages().length} fallback={<text fg="#6e7681">No messages synced yet.</text>}>
                  <For each={chatMessages()}>{(message) => (
                    <box
                      flexDirection="column"
                      paddingLeft={1}
                      paddingRight={1}
                      border={["left"]}
                      borderColor={message.role === "user" ? "#3fb950" : "#58a6ff"}
                    >
                      <text fg={message.role === "user" ? "#3fb950" : "#58a6ff"}>
                        <b>{message.role === "user" ? "YOU" : chatEndpoint()?.system?.toUpperCase() || "AI"}</b>
                      </text>
                      <text fg="#c9d1d9">{message.content}</text>
                    </box>
                  )}</For>
                </Show>
              </scrollbox>

              <box
                height={3}
                marginTop={1}
                paddingLeft={1}
                paddingRight={1}
                border
                borderColor="#58a6ff"
                alignItems="center"
              >
                <text fg="#58a6ff">› </text>
                <input
                  ref={(value) => (chatInput = value)}
                  focused
                  flexGrow={1}
                  maxLength={8000}
                  placeholder={busy() ? "sending…" : `Message this ${chatEndpoint()?.system || "AI"} session…`}
                  onSubmit={(value) => void submitChat(typeof value === "string" ? value : chatInput?.value || "")}
                />
              </box>
            </box>
          </Show>
        </box>

        <box
          width={42}
          flexDirection="column"
          padding={1}
          borderColor={focus() === "agents" ? "#58a6ff" : "#30363d"}
        >
          <text fg="#f0f6fc"><b>AGENTS</b> <span style={{ fg: "#58a6ff" }}>{allAgents().length}</span></text>
          <text fg="#6e7681">connected conversations</text>
          <text> </text>

          <Show when={allAgents().length} fallback={<text fg="#6e7681">No endpoints connected. Refresh an open supported AI tab.</text>}>
            <For each={allAgents().slice(0, 12)}>{(agent, i) => (
              <box flexDirection="column" marginBottom={1}>
                <text fg={i() === agentIndex() ? "#f0f6fc" : "#8b949e"}>
                  {i() === agentIndex() ? "›" : " "} {STATUS[agent.status] || "·"} <b>{agent.system}</b> {agent.title.slice(0, 23)}
                </text>
                <text fg="#484f58">
                  {"    "}{STATUS_LABEL[agent.status] || agent.status.toUpperCase()} · {agent.subject || "Unsorted"} · {age(agent.updatedAt)}
                </text>
              </box>
            )}</For>
          </Show>

          <Show when={capture()}>
            <text> </text>
            <text fg="#58a6ff"><b>ROUTING BUFFER</b></text>
            <text fg="#8b949e">{captureSource()}</text>
            <text fg="#484f58">{capture().length} chars ready</text>
          </Show>

          <text> </text>
          <text fg="#58a6ff"><b>RECENT</b></text>
          <For each={events().slice(0, 5)}>{(event) => (
            <text fg="#484f58">{age(event.createdAt).padStart(4)} {eventLabel(event).slice(0, 30)}</text>
          )}</For>
        </box>
      </box>

      <box height={4} flexDirection="column" paddingLeft={2} paddingRight={2} border={["top"]} borderColor="#30363d">
        <text fg={busy() ? "#d29922" : "#8b949e"}>
          {busy() ? "working…" : notice()}
          <Show when={capture()}>
            <span style={{ fg: "#58a6ff" }}> · buffer ready</span>
          </Show>
        </text>
        <Show
          when={lens() === "chat"}
          fallback={
            <text fg="#6e7681">
              H home   R room   F files   S chats   A activity   Tab focus   ↑/↓ move   Enter open   q quit
            </text>
          }
        >
          <text fg="#6e7681">Enter send · Esc home · Ctrl+C quit</text>
        </Show>
      </box>
    </box>
  )
}
