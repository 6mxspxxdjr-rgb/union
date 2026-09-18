import { UI } from "../theme"

export function ConversationTurn(props: {
  label: string
  content: string
  tone?: "user" | "chatgpt" | "deepseek" | "neutral"
  meta?: string
}) {
  const color = () => {
    if (props.tone === "user") return UI.green
    if (props.tone === "deepseek") return UI.violet
    if (props.tone === "chatgpt") return UI.accent
    return UI.muted
  }

  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      marginBottom={1}
      border={["left"]}
      borderColor={color()}
    >
      <text fg={color()}>
        <b>{props.label}</b>
        {props.meta ? <span style={{ fg: UI.dim }}> · {props.meta}</span> : null}
      </text>
      <text fg={UI.textSoft}>{props.content}</text>
    </box>
  )
}
