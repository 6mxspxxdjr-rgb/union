import { For, Show, createMemo } from "solid-js"
import type { Endpoint } from "../../core/types"
import { UI, STATUS_LABEL, STATUS_MARK, age, statusColor } from "../theme"

export function AgentRail(props: {
  agents: Endpoint[]
  selectedId?: string
  focused: boolean
  recent: Array<{ createdAt: number; label: string }>
}) {
  const attention = createMemo(() => props.agents.filter((a) => a.status === "needs_you" || a.status === "failed"))
  const working = createMemo(() => props.agents.filter((a) => a.status === "working"))
  const available = createMemo(() => props.agents.filter((a) => !["needs_you", "failed", "working", "offline"].includes(a.status)))
  const offline = createMemo(() => props.agents.filter((a) => a.status === "offline"))

  const Group = (groupProps: { title: string; agents: Endpoint[] }) => (
    <Show when={groupProps.agents.length}>
      <text fg={UI.dim}><b>{groupProps.title}</b></text>
      <For each={groupProps.agents}>{(agent) => {
        const selected = () => agent.id === props.selectedId
        return (
          <box
            flexDirection="column"
            paddingLeft={1}
            paddingTop={selected() ? 0 : 0}
            marginBottom={1}
            backgroundColor={selected() ? UI.surfaceAlt : undefined}
          >
            <text fg={selected() ? UI.text : UI.textSoft}>
              <span style={{ fg: statusColor(agent.status) }}>{STATUS_MARK[agent.status] || "·"}</span>
              {" "}<b>{agent.system}</b>{" "}{agent.title.slice(0, 19)}
            </text>
            <text fg={UI.dim}>
              {"  "}{STATUS_LABEL[agent.status] || agent.status.toUpperCase()} · {age(agent.updatedAt)}
            </text>
          </box>
        )
      }}</For>
      <text> </text>
    </Show>
  )

  return (
    <box
      width={36}
      flexDirection="column"
      padding={1}
      borderColor={props.focused ? UI.accent : UI.borderStrong}
    >
      <text fg={UI.text}><b>AGENTS</b> <span style={{ fg: UI.accent }}>{props.agents.filter((a) => a.status !== "offline").length}</span></text>
      <text fg={UI.dim}>live browser conversations</text>
      <text> </text>

      <Show when={props.agents.length} fallback={<text fg={UI.dim}>Open ChatGPT or DeepSeek in Chrome.</text>}>
        <Group title="NEEDS ATTENTION" agents={attention()} />
        <Group title="WORKING" agents={working()} />
        <Group title="READY" agents={available()} />
        <Show when={offline().length}>
          <text fg={UI.dim}>OFFLINE · {offline().length}</text>
          <text> </text>
        </Show>
      </Show>

      <box flexGrow={1} />

      <text fg={UI.dim}><b>RECENT</b></text>
      <For each={props.recent.slice(0, 4)}>{(item) => (
        <text fg={UI.dim}>{age(item.createdAt).padStart(4)}  {item.label.slice(0, 25)}</text>
      )}</For>
    </box>
  )
}
