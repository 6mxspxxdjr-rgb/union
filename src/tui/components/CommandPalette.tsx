import { For, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Dialog } from "./Dialog"
import { UI } from "../theme"

export type PaletteCommand = {
  id: string
  label: string
  description: string
  hint?: string
  keywords?: string[]
}

export function CommandPalette(props: {
  commands: PaletteCommand[]
  onRun: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal(0)

  const results = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return props.commands
    return props.commands.filter((command) =>
      [command.label, command.description, command.id, ...(command.keywords || [])]
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
  })

  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onClose()
      key.preventDefault()
      return
    }
    if (key.name === "up") {
      setSelected((i) => Math.max(0, i - 1))
      key.preventDefault()
      return
    }
    if (key.name === "down") {
      setSelected((i) => Math.min(Math.max(0, results().length - 1), i + 1))
      key.preventDefault()
      return
    }
  })

  const runSelected = () => {
    const command = results()[selected()]
    if (command) props.onRun(command.id)
  }

  return (
    <Dialog width={72} height={19}>
      <text fg={UI.text}><b>COMMANDS</b></text>
      <text fg={UI.dim}>Jump anywhere in Union</text>
      <text> </text>

      <box height={3} paddingLeft={1} paddingRight={1} border borderColor={UI.borderStrong} alignItems="center">
        <text fg={UI.accent}>› </text>
        <input
          focused
          flexGrow={1}
          value={query()}
          placeholder="Search actions..."
          backgroundColor={UI.surface}
          textColor={UI.text}
          focusedBackgroundColor={UI.surface}
          focusedTextColor={UI.text}
          placeholderColor={UI.dim}
          cursorColor={UI.accent}
          onInput={(value) => {
            setQuery(value)
            setSelected(0)
          }}
          onSubmit={runSelected}
        />
      </box>

      <text> </text>
      <box flexGrow={1} flexDirection="column" overflow="hidden">
        <For each={results().slice(0, 9)}>{(command, i) => {
          const active = () => i() === selected()
          return (
            <box
              height={2}
              flexDirection="column"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={active() ? UI.surfaceAlt : undefined}
              onMouseDown={() => props.onRun(command.id)}
            >
              <text fg={active() ? UI.text : UI.textSoft}>
                <span style={{ fg: active() ? UI.accent : UI.dim }}>{active() ? "▌" : " "}</span>
                {" "}{command.label}
                {command.hint ? <span style={{ fg: UI.dim }}>  {command.hint}</span> : null}
              </text>
              <text fg={UI.dim}>   {command.description}</text>
            </box>
          )
        }}</For>
      </box>

      <text fg={UI.dim}>↑↓ navigate · Enter run · Esc close</text>
    </Dialog>
  )
}
