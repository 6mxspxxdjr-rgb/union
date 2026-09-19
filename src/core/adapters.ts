import type { Endpoint, UnionAdapter, UnionMessage } from "./types"

export class AdapterRegistry {
  private adapters = new Map<string, UnionAdapter>()

  register(adapter: UnionAdapter) {
    if (this.adapters.has(adapter.id)) throw new Error(`Adapter already registered: ${adapter.id}`)
    this.adapters.set(adapter.id, adapter)
    return () => this.adapters.delete(adapter.id)
  }

  get(id: string) {
    return this.adapters.get(id)
  }

  list() {
    return [...this.adapters.values()]
  }

  async discoverAll(): Promise<Endpoint[]> {
    const settled = await Promise.allSettled(this.list().map((adapter) => adapter.discover()))
    return settled.flatMap((result) => result.status === "fulfilled" ? result.value : [])
  }

  async read(endpoint: Endpoint): Promise<UnionMessage[]> {
    const adapter = this.adapters.get(endpoint.adapterId)
    if (!adapter) throw new Error(`Missing adapter: ${endpoint.adapterId}`)
    return adapter.read(endpoint.id)
  }

  async readLatest(endpoint: Endpoint): Promise<string> {
    const adapter = this.adapters.get(endpoint.adapterId)
    if (!adapter) throw new Error(`Missing adapter: ${endpoint.adapterId}`)
    if (!adapter.readLatest) {
      const messages = await adapter.read(endpoint.id)
      return [...messages].reverse().find((message) => message.role === "assistant")?.content.trim() ?? ""
    }
    return adapter.readLatest(endpoint.id)
  }

  async send(endpoint: Endpoint, content: string, submit = false) {
    const adapter = this.adapters.get(endpoint.adapterId)
    if (!adapter) throw new Error(`Missing adapter: ${endpoint.adapterId}`)
    return adapter.send(endpoint.id, content, submit)
  }

  async dispose() {
    await Promise.all(this.list().map((adapter) => adapter.dispose?.()))
  }
}
