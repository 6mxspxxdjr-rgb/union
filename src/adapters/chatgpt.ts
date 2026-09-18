import { id } from "../core/id"
import type { Capability, Endpoint, UnionAdapter, UnionMessage } from "../core/types"
import type { BridgeServer } from "../services/bridge-server"

export class ChatGPTAdapter implements UnionAdapter {
  id = "chatgpt-browser"
  label = "ChatGPT Browser"
  capabilities: Capability[] = ["discover", "read", "send", "submit", "stream"]

  constructor(private bridge: BridgeServer) {}

  async discover(): Promise<Endpoint[]> {
    return this.bridge.list("ChatGPT")
  }

  async read(endpointId: string): Promise<UnionMessage[]> {
    const data = await this.bridge.request<{ content?: string; title?: string }>(endpointId, "read_latest")
    if (!data?.content) return []
    return [{
      id: id("msg"),
      endpointId,
      role: "assistant",
      content: data.content,
      createdAt: Date.now(),
      metadata: { title: data.title },
    }]
  }

  async send(endpointId: string, content: string, submit = false) {
    await this.bridge.request(endpointId, "inject", { content, submit })
  }
}
