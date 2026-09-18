import { stableId } from "../core/id"
import type { Capability, Endpoint, UnionAdapter, UnionMessage } from "../core/types"
import type { BridgeServer } from "../services/bridge-server"

type ThreadMessage = {
  role: "user" | "assistant"
  content: string
  index: number
}

export class ChatGPTAdapter implements UnionAdapter {
  id = "chatgpt-browser"
  label = "ChatGPT Browser"
  capabilities: Capability[] = ["discover", "read", "send", "submit", "stream"]

  constructor(private bridge: BridgeServer) {}

  async discover(): Promise<Endpoint[]> {
    return this.bridge.list("ChatGPT")
  }

  async read(endpointId: string): Promise<UnionMessage[]> {
    const data = await this.bridge.request<{ messages?: ThreadMessage[] }>(endpointId, "read_thread")
    const now = Date.now()
    return (data?.messages ?? []).map((message) => ({
      id: stableId("msg", `${endpointId}:${message.index}:${message.role}`),
      endpointId,
      role: message.role,
      content: message.content,
      createdAt: now + message.index,
      metadata: { threadIndex: message.index },
    }))
  }

  async send(endpointId: string, content: string, submit = false) {
    await this.bridge.request(endpointId, "inject", { content, submit })
  }
}
