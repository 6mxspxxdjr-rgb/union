export const UI = {
  bg: "#0b0d10",
  surface: "#11161c",
  surfaceAlt: "#161d26",
  border: "#252d38",
  borderStrong: "#30363d",
  text: "#f0f6fc",
  textSoft: "#c9d1d9",
  muted: "#8b949e",
  dim: "#484f58",
  accent: "#58a6ff",
  green: "#3fb950",
  violet: "#a371f7",
  amber: "#d29922",
  red: "#f85149",
} as const

export const STATUS_MARK: Record<string, string> = {
  working: "●",
  waiting: "○",
  needs_you: "◆",
  done: "✓",
  failed: "!",
  paused: "∥",
  offline: "×",
}

export const STATUS_LABEL: Record<string, string> = {
  working: "WORKING",
  waiting: "READY",
  needs_you: "NEEDS YOU",
  done: "DONE",
  failed: "FAILED",
  paused: "PAUSED",
  offline: "OFFLINE",
}

export function statusColor(status: string) {
  if (status === "working") return UI.accent
  if (status === "needs_you") return UI.amber
  if (status === "failed") return UI.red
  if (status === "done") return UI.green
  if (status === "offline") return UI.dim
  return UI.muted
}

export function age(ts: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
