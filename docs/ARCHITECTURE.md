# Union Architecture

## Product definition

Union is a terminal-native semantic shell over a computer and its connected AI systems.

It has three distinct layers:

```text
truth       -> files, external systems, native histories
memory      -> events, indexes, summaries, relations, embeddings
interface   -> Union lenses, routing, context compilation
```

Union does not need to become the smartest agent. Its leverage comes from giving powerful systems a shared control plane and a shared context layer.

## Primary objects

Union normalizes the workspace into five concepts:

- **System**: ChatGPT, Hermes, Claude, Codex, Ollama, browser agents, etc.
- **Subject**: semantic grouping such as `Union`, `Employment`, or `Content`.
- **Thread**: one conversation or agent session.
- **Task**: a unit of work with normalized state.
- **Artifact**: a file, generated output, report, patch or other durable result.

Files remain files on disk. Union stores metadata and relations separately.

## Universal adapter boundary

Adapters translate system-specific capabilities into a small Union contract:

```ts
interface UnionAdapter {
  id: string
  label: string
  capabilities: Capability[]

  discover(): Promise<Endpoint[]>
  read(endpointId: string): Promise<UnionMessage[]>
  send(endpointId: string, content: string, submit?: boolean): Promise<void>
  interrupt?(endpointId: string): Promise<void>
}
```

The Union core must never depend on ChatGPT DOM selectors, Hermes CLI syntax, or a provider SDK. Those details belong inside adapters.

## Normalized endpoint state

Provider-specific states collapse into a small visual model:

```text
working
waiting
needs_you
done
failed
paused
offline
```

This is more useful in the cockpit than exposing every provider's internal vocabulary.

## Filesystem model

Union presents two views over the same physical files.

### Physical lens

```text
~/Projects
  union/
  content/
  experiments/
```

### Semantic lens

```text
Content
Employment
Trading
Union
```

The semantic lens is an index, not a second filesystem. Moving between lenses never duplicates files.

## ICM

ICM is the memory/context compiler underneath Union.

```text
raw history + files + endpoint state
                |
                v
          durable event ledger
                |
                v
      metadata / relations / summaries
                |
                v
          context compiler
                |
                v
         bounded context pack
```

The core rule is that compiled memory is not canonical truth. Union can always return to the source file, source message or source event.

### v0 scoring

The initial context compiler intentionally stays deterministic:

- selected file receives a strong focus boost
- files in the same subject receive a subject boost
- recently modified files receive a recency boost
- active endpoints in the subject receive an activity boost
- results are alphabetically deterministic on score ties

Future versions can add embeddings, graph relations, model-generated summaries and learned relevance without changing the object boundary.

## Event ledger

Meaningful operations append events to SQLite:

```text
file.indexed
file.changed
endpoint.connected
endpoint.status
message.received
message.sent
context.compiled
subject.assigned
```

The UI reads an in-memory/current projection; SQLite provides persistence and reconstruction.

## Terminal rendering

Union follows two lessons from mature open-source TUIs:

- OpenCode: commands/keybindings should be registered separately from presentation so the same command can be invoked from keys, a palette or automation.
- Browser Use Terminal: committed transcript/history and live changing content should have different ownership to avoid redraw/scrollback problems.

v0 uses a fixed cockpit layout. A later transcript surface should send completed AI output into native terminal scrollback while keeping only live generation and controls in the active viewport.

## ChatGPT bridge

The first adapter uses a Chromium content script.

```text
ChatGPT tab
   |
   | websocket localhost:7331
   v
BridgeServer
   |
   v
ChatGPTAdapter
   |
   v
Union core
```

The extension exposes only normalized operations:

```text
inspect
read_latest
inject
inject + submit
```

The browser keeps authentication. Union does not need ChatGPT cookies or credentials.

## Security direction

v0 binds the bridge to `127.0.0.1` only. Before adding remote access, Union should add explicit endpoint authentication, origin checks, per-adapter permissions and an approval model for filesystem mutations and external side effects.
