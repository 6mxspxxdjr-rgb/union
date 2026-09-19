import type { JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { UI } from "../theme"

export function Dialog(props: {
  width?: number
  height?: number
  children?: JSX.Element
}) {
  const dims = useTerminalDimensions()
  const width = () => Math.min(props.width ?? 68, Math.max(30, dims().width - 4))
  const height = () => Math.min(props.height ?? 20, Math.max(8, dims().height - 4))
  const left = () => Math.max(1, Math.floor((dims().width - width()) / 2))
  const top = () => Math.max(1, Math.floor((dims().height - height()) / 2))

  return (
    <box
      position="absolute"
      left={left()}
      top={top()}
      width={width()}
      height={height()}
      flexDirection="column"
      padding={1}
      border
      borderStyle="rounded"
      borderColor={UI.accent}
      backgroundColor={UI.surface}
    >
      {props.children}
    </box>
  )
}
