import { For, Show } from "solid-js"
import { UI } from "../theme"

type Subject = { title: string; files: number; active: number }

export function ShellSidebar(props: {
  active: string
  subjects: Subject[]
  subjectIndex: number
  focused: boolean
}) {
  const nav = [
    ["subjects", "H", "Home"],
    ["room", "R", "Room"],
    ["agents", "S", "Chats"],
    ["files", "F", "Files"],
    ["activity", "A", "Activity"],
  ] as const

  return (
    <box
      width={27}
      flexDirection="column"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
      border={["right"]}
      borderColor={props.focused ? UI.accent : UI.borderStrong}
    >
      <text fg={UI.dim}><b>WORKSPACE</b></text>
      <text> </text>

      <For each={nav}>{([id, key, label]) => {
        const active = () => props.active === id || (id === "agents" && props.active === "chat")
        return (
          <box
            height={2}
            flexDirection="column"
            paddingLeft={1}
            backgroundColor={active() ? UI.surfaceAlt : undefined}
          >
            <text fg={active() ? UI.text : UI.muted}>
              <span style={{ fg: active() ? UI.accent : UI.dim }}>{active() ? "▌" : " "}</span>
              {" "}<b>{label}</b>
            </text>
            <text fg={UI.dim}>   {key}</text>
          </box>
        )
      }}</For>

      <text> </text>
      <text fg={UI.dim}><b>CONTEXT</b></text>
      <text fg={UI.dim}>{props.subjects.length} subjects</text>
      <text> </text>

      <Show when={props.subjects.length} fallback={<text fg={UI.dim}>No indexed context yet.</text>}>
        <For each={props.subjects.slice(0, 14)}>{(subject, i) => (
          <box height={2} flexDirection="column" paddingLeft={1}>
            <text fg={i() === props.subjectIndex ? UI.textSoft : UI.muted}>
              {i() === props.subjectIndex ? "› " : "  "}{subject.title.slice(0, 18)}
            </text>
            <text fg={UI.dim}>
              {"  "}{subject.active ? `${subject.active} active` : `${subject.files} files`}
            </text>
          </box>
        )}</For>
      </Show>
    </box>
  )
}
