export type CommandContext = {
  rescan: () => Promise<void>
  setLens: (lens: string) => void
  notify: (message: string) => void
}

export type UnionCommand = {
  name: string
  aliases?: string[]
  title: string
  description: string
  run: (args: string[], ctx: CommandContext) => Promise<void> | void
}

export class CommandRegistry {
  private commands = new Map<string, UnionCommand>()

  register(command: UnionCommand) {
    this.commands.set(command.name, command)
    for (const alias of command.aliases ?? []) this.commands.set(alias, command)
    return this
  }

  list() {
    return [...new Map([...this.commands.values()].map((command) => [command.name, command])).values()].sort((a, b) => a.title.localeCompare(b.title))
  }

  async execute(input: string, ctx: CommandContext) {
    const parts = input.trim().replace(/^:/, "").split(/\s+/).filter(Boolean)
    if (!parts.length) return
    const name = parts.shift()!
    const command = this.commands.get(name)
    if (!command) throw new Error(`Unknown command: ${name}`)
    await command.run(parts, ctx)
  }
}
