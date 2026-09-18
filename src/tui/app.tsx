import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import type { UnionRuntime } from "../core/runtime"
import type { Endpoint, FileRecord } from "../core/types"

type Lens = "subjects" | "files" | "agents" | "activity"
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

function age(ts: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function App(props: { runtime: UnionRuntime }) {
  const renderer = useRenderer()
  const [tick, setTick] = createSignal(0)
  const [lens, setLens] = createSignal<Lens>("subjects")
  const [focus, setFocus] = createSignal<Focus>("subjects")
  const [subjectIndex, setSubjectIndex] = createSignal(0)
  const [fileIndex, setFileIndex] = createSignal(0)
  const [agentIndex, setAgentIndex] = createSignal(0)
  const [notice, setNotice] = createSignal("ready · indexing runs in background")
  const [capture, setCapture] = createSignal("")
  const [captureSource, setCaptureSource] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  // Refresh from actual Union events instead of hammering SQLite every second.
  const offEvent = props.runtime.events.on(() => setTick((v) => v + 1))
  const clock = setInterval(() => setTick((v) => v + 1), 15_000)
  onCleanup(() => {
    offEvent()
    clearInterval(clock)
  })

  const subjects = createMemo(() => {
    tick()
    return props.runtime.subjects()
  })
  const selectedSubject = createMemo(() => subjects()[Math.min(subjectIndex(), Math.max(0, subjects().length - 1))]?.title)
  const files = createMemo(() => {
    tick()
    return lens() === "files" ? props.runtime.files() : props.runtime.files(selectedSubject())
  })
  const agents = createMemo(() => {
    tick()
    return lens() === "agents" ? props.runtime.endpoints() : props.runtime.endpoints(selectedSubject())
  })
  const selectedFile = createMemo<FileRecord | undefined>(() => files()[Math.min(fileIndex(), Math.max(0, files().length - 1))])
  const selectedAgent = createMemo<Endpoint | undefined>(() => agents()[Math.min(agentIndex(), Math.max(0, agents().length - 1))])
  const context = createMemo(() => props.runtime.icm.compile({ subject: selectedSubject(), fileId: selectedFile()?.id, endpointId: selectedAgent()?.id }))
  const preview = createMemo(() => props.runtime.preview(selectedFile()).split("\n").slice(0, 8))
  const events = createMemo(() => {
    tick()
    return props.runtime.db.recentEvents(12)
  })

  function move(delta: number) {
    if (focus() === "subjects") {
      setSubjectIndex((i) => Math.max(0, Math.min(subjects().length - 1, i + delta)))
      setFileIndex(0); setAgentIndex(0)
    } else if (focus() === "files") {
      setFileIndex((i) => Math.max(0, Math.min(files().length - 1, i + delta)))
    } else {
      setAgentIndex((i) => Math.max(0, Math.min(agents().length - 1, i + delta)))
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
    } catch (error) { setNotice(String(error)) } finally { setBusy(false); setTick((v) => v + 1) }
  }

  function captureContext() {
    const pack = context()
    const materialized = props.runtime.icm.materialize(pack)
    setCapture(materialized)
    setCaptureSource(`ICM / ${selectedSubject() || "Workspace"}`)
    setNotice(`compiled ${pack.items.length} context items · ${materialized.length} chars`)
    props.runtime.events.emit("context.compiled", { items: pack.items.length, chars: materialized.length }, { subject: selectedSubject(), objectId: selectedFile()?.id })
  }

  async function paste(submit: boolean) {
    const endpoint = selectedAgent()
    if (!endpoint) return setNotice("select a destination endpoint")
    if (!capture()) return setNotice("capture is empty; press y on a source endpoint")
    setBusy(true)
    try {
      await props.runtime.send(endpoint, capture(), submit)
      setNotice(`${submit ? "sent" : "injected"} capture → ${endpoint.title}`)
    } catch (error) { setNotice(String(error)) } finally { setBusy(false); setTick((v) => v + 1) }
  }

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") renderer.destroy()
    else if (key.name === "q") renderer.destroy()
    else if (key.name === "1") { setLens("subjects"); setFocus("subjects") }
    else if (key.name === "2") { setLens("files"); setFocus("files") }
    else if (key.name === "3") { setLens("agents"); setFocus("agents") }
    else if (key.name === "4") setLens("activity")
    else if (key.name === "tab") setFocus((current) => current === "subjects" ? "files" : current === "files" ? "agents" : "subjects")
    else if (key.name === "j" || key.name === "down") move(1)
    else if (key.name === "k" || key.name === "up") move(-1)
    else if (key.name === "r") void props.runtime.rescan().then((n) => { setNotice(`indexed ${n} files`); setTick((v) => v + 1) })
    else if (key.name === "o" && selectedFile()) { props.runtime.openFile(selectedFile()!); setNotice(`opened ${selectedFile()!.title}`) }
    else if (key.name === "y") void yank()
    else if (key.name === "c") captureContext()
    else if (key.name === "p") void paste(Boolean(key.shift))
  })

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#0b0d10">
      <box height={3} paddingLeft={2} paddingRight={2} justifyContent="space-between" alignItems="center" border={["bottom"]} borderColor="#30363d">
        <text fg="#f0f6fc"><b>UNION</b>  <span style={{ fg: "#8b949e" }}>AI control plane · semantic filesystem · ICM</span></text>
        <text fg="#8b949e">{props.runtime.root}</text>
      </box>

      <box flexGrow={1} flexDirection="row">
        <box width={28} flexDirection="column" padding={1} border={["right"]} borderColor={focus() === "subjects" ? "#58a6ff" : "#30363d"}>
          <text fg="#8b949e"><b>SUBJECTS</b>  {subjects().length}</text>
          <text> </text>
          <For each={subjects().slice(0, 24)}>{(subject, i) => (
            <text fg={i() === subjectIndex() ? "#f0f6fc" : "#8b949e"}>
              {i() === subjectIndex() ? "›" : " "} {subject.title.padEnd(17).slice(0,17)} <span style={{ fg: "#6e7681" }}>{String(subject.files).padStart(3)}</span>{subject.active ? `  ●${subject.active}` : ""}
            </text>
          )}</For>
        </box>

        <box flexGrow={1} minWidth={45} flexDirection="column" padding={1} border={["right"]} borderColor={focus() === "files" ? "#58a6ff" : "#30363d"}>
          <text fg="#8b949e"><b>{lens() === "files" ? "FILES" : selectedSubject() || "WORKSPACE"}</b></text>
          <text> </text>
          <Show when={lens() !== "activity"} fallback={
            <For each={events()}>{(event) => <text fg="#8b949e">{age(event.createdAt).padStart(4)}  <span style={{ fg: "#c9d1d9" }}>{event.type}</span>  {String(event.payload.title || event.payload.path || event.payload.system || "").slice(0,50)}</text>}</For>
          }>
            <For each={files().slice(0, 14)}>{(file, i) => (
              <text fg={i() === fileIndex() ? "#f0f6fc" : "#8b949e"}>
                {i() === fileIndex() ? "›" : " "} {file.title.slice(0, 34).padEnd(35)} <span style={{ fg: "#6e7681" }}>{file.extension || "file"} {age(file.modifiedAt)}</span>
              </text>
            )}</For>
            <Show when={selectedFile()}>
              <text> </text>
              <Show when={lens() === "files"} fallback={
                <box flexDirection="column">
                  <text fg="#58a6ff"><b>CONTEXT</b></text>
                  <For each={context().items.slice(0, 6)}>{(item) => <text fg="#8b949e">  {item.kind === "file" ? "□" : "◈"} {item.title.slice(0,42)} <span style={{ fg: "#6e7681" }}>{item.reason}</span></text>}</For>
                </box>
              }>
                <box flexDirection="column">
                  <text fg="#58a6ff"><b>PREVIEW</b> <span style={{ fg: "#6e7681" }}>{selectedFile()!.path}</span></text>
                  <For each={preview()}>{(line) => <text fg="#8b949e">{line.slice(0, 74)}</text>}</For>
                </box>
              </Show>
            </Show>
          </Show>
        </box>

        <box width={39} flexDirection="column" padding={1} borderColor={focus() === "agents" ? "#58a6ff" : "#30363d"}>
          <text fg="#8b949e"><b>AI SYSTEMS</b>  {agents().length}</text>
          <text> </text>
          <Show when={agents().length} fallback={<text fg="#6e7681">No connected endpoints. Load the ChatGPT bridge extension, then refresh a ChatGPT tab.</text>}>
            <For each={agents().slice(0, 10)}>{(agent, i) => (
              <box flexDirection="column" marginBottom={1}>
                <text fg={i() === agentIndex() ? "#f0f6fc" : "#8b949e"}>
                  {i() === agentIndex() ? "›" : " "} {STATUS[agent.status] || "·"} <span style={{ fg: "#c9d1d9" }}>{agent.system}</span>  {agent.title.slice(0,21)}
                </text>
                <text fg="#6e7681">    {agent.status.toUpperCase()} · {age(agent.updatedAt)}</text>
              </box>
            )}</For>
          </Show>
          <text> </text>
          <text fg="#58a6ff"><b>ACTIVITY</b></text>
          <For each={events().slice(0, 6)}>{(event) => <text fg="#6e7681">{age(event.createdAt).padStart(4)} {event.type.slice(0,22)}</text>}</For>
        </box>
      </box>

      <box height={4} flexDirection="column" paddingLeft={2} paddingRight={2} border={["top"]} borderColor="#30363d">
        <text fg={busy() ? "#d29922" : "#8b949e"}>{busy() ? "working…" : notice()} <Show when={capture()}><span style={{ fg: "#58a6ff" }}> · capture: {captureSource()} ({capture().length} chars)</span></Show></text>
        <text fg="#6e7681">1 subjects  2 files  3 agents  4 activity  tab focus  j/k move  y AI→buffer  c context→buffer  p inject  ⇧p submit  o open  r rescan  q quit</text>
      </box>
    </box>
  )
}
