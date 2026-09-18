import { Show } from "solid-js"
import { UI } from "../theme"

export function StatusBar(props: {
  notice: string
  busy: boolean
  connected: number
  working: number
  bufferReady: boolean
  chatMode: boolean
}) {
  return (
    <box
      height={3}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="column"
      border={["top"]}
      borderColor={UI.borderStrong}
    >
      <box height={1} justifyContent="space-between">
        <text fg={props.busy ? UI.amber : UI.muted}>
          {props.busy ? "working…" : props.notice}
          <Show when={props.bufferReady}><span style={{ fg: UI.accent }}> · buffer ready</span></Show>
        </text>
        <text fg={UI.dim}>● {props.connected} connected · {props.working} working</text>
      </box>
      <text fg={UI.dim}>
        {props.chatMode
          ? "Enter send · Esc home · Ctrl+P commands · ? help"
          : "Ctrl+P commands · ? help · Tab focus · ↑↓ move · Enter open · q quit"}
      </text>
    </box>
  )
}
