import { useKeyboard } from "@opentui/solid"
import { Dialog } from "./Dialog"
import { UI } from "../theme"

export function HelpOverlay(props: { onClose: () => void }) {
  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "?" || key.name === "q") {
      props.onClose()
      key.preventDefault()
    }
  })

  return (
    <Dialog width={70} height={20}>
      <text fg={UI.text}><b>UNION HELP</b></text>
      <text fg={UI.dim}>The interface should be discoverable. These are accelerators, not requirements.</text>
      <text> </text>

      <text fg={UI.accent}><b>NAVIGATION</b></text>
      <text fg={UI.textSoft}>H  Home        R  Room        S  Chats</text>
      <text fg={UI.textSoft}>F  Files       A  Activity    Tab  change focus</text>
      <text> </text>

      <text fg={UI.accent}><b>GLOBAL</b></text>
      <text fg={UI.textSoft}>Ctrl+P / Space  command palette</text>
      <text fg={UI.textSoft}>?               this help</text>
      <text fg={UI.textSoft}>↑ / ↓           move selection</text>
      <text fg={UI.textSoft}>Enter           open selected chat</text>
      <text fg={UI.textSoft}>O               open browser or reveal file</text>
      <text> </text>

      <text fg={UI.accent}><b>ROOM</b></text>
      <text fg={UI.textSoft}>[ / ]           decrease / increase turns (2–30)</text>
      <text fg={UI.textSoft}>Shift+P         choose ChatGPT↔ChatGPT or ChatGPT↔DeepSeek</text>
      <text fg={UI.textSoft}>Enter           start the shared task</text>
      <text> </text>

      <text fg={UI.dim}>Esc · ? · q closes this panel</text>
    </Dialog>
  )
}
