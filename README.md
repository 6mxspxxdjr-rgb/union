# Union

Union is a terminal-native control plane for AI systems, files, memory, and context.

It is intentionally **not** another chatbot. ChatGPT, Hermes, local models, browser agents, coding agents, and future systems keep their own compute and capabilities. Union sits above them to make the entire environment observable, routable, and self-organizing.

## v0 goals

- terminal-native OpenTUI interface
- semantic file manager over the real filesystem
- automatic titles and alphabetical subject organization
- durable local event/message/file memory in SQLite
- ICM context compilation from related files and active systems
- universal adapter boundary for external AI systems
- ChatGPT browser adapter first
- rapid AI-to-AI relay

## Current interaction

The first vertical slice is deliberately keyboard-first:

- `1` subject lens
- `2` physical file lens
- `3` AI systems lens
- `4` activity lens
- `Tab` change focused pane
- `j` / `k` or arrows move
- `y` capture the latest reply from the selected AI endpoint
- `c` compile the selected subject into an ICM context pack
- `p` inject the current capture into the selected AI endpoint
- `Shift+P` inject and submit
- `r` rescan files
- `q` quit

This gives Union two useful routes immediately:

```text
AI reply -> Union capture -> another AI tab
workspace/files -> ICM context pack -> AI tab
```

## Architecture

```text
                    UNION TUI
                       |
            +----------+----------+
            |          |          |
          FILES      SYSTEMS     TASKS
            |          |          |
            +----------+----------+
                       |
                      ICM
             context + memory layer
                       |
              universal adapters
                       |
       +---------------+----------------+
       |               |                |
    ChatGPT          Hermes          anything
```

Four rules keep the architecture clean:

1. **The filesystem is truth.** Union indexes it; Union does not silently rearrange it.
2. **ICM is the map.** Summaries, subjects, context packs, memory and relationships are derived layers.
3. **Models are compute.** Union should ask external/local AI systems to do expensive reasoning instead of reimplementing their intelligence.
4. **Union is the interface.** It normalizes state, routing, history and visualization.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the deeper model.

## Requirements

- macOS or Linux
- Bun 1.3+
- Node 26.4+ is recommended by the current OpenTUI release
- Chromium-based browser for the initial ChatGPT bridge

## Run

```bash
bun install
bun run start
```

By default Union indexes the directory you launch it from.

To point Union at a specific workspace:

```bash
bun run start ~/Projects
```

Or:

```bash
UNION_ROOT=~/Projects bun run start
```

Union keeps derived local state at:

```text
~/.union/union.db
```

The first run scans the selected root while excluding common heavy/system directories such as `.git`, `node_modules`, build outputs and macOS caches.

## Connect ChatGPT

The v0 ChatGPT adapter is a tiny Chromium content-script extension that opens a local WebSocket back to Union.

1. Start Union.
2. Open your browser's extensions page.
3. Enable Developer Mode.
4. Choose **Load unpacked**.
5. Select `extension/chatgpt/` from this repository.
6. Refresh any open `chatgpt.com` conversations.

Each open conversation becomes a Union endpoint.

No ChatGPT credentials are stored by Union. The adapter acts through the already-open browser tab.

## Relay example

Open two ChatGPT conversations. In Union:

1. Focus **AI SYSTEMS** with `Tab`.
2. Select the source conversation.
3. Press `y` to capture its latest assistant response.
4. Select the destination conversation.
5. Press `p` to place it in the composer, or `Shift+P` to place it and send it.

## ICM context example

1. Select a subject such as `Union`.
2. Select a relevant file.
3. Press `c`.
4. Union ranks related files by focus, subject and recency and materializes a bounded context pack.
5. Select a ChatGPT endpoint and press `p` or `Shift+P`.

v0 uses deterministic local classification and ranking. The adapter boundary is designed so later versions can delegate title generation, classification, summarization and semantic ranking to cheap local models or other connected AI systems.

## Repository layout

```text
src/
  adapters/        external AI adapters
  core/            universal types, ICM, events, commands, runtime
  services/        SQLite, filesystem indexing, localhost bridge
  tui/             OpenTUI/Solid interface
extension/
  chatgpt/         browser adapter for open ChatGPT tabs
docs/
  ARCHITECTURE.md  product + technical architecture
  ROADMAP.md       staged build plan
```

## Open source foundations

Union uses OpenTUI directly and borrows architectural lessons from OpenCode and Browser Use Terminal. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The intention is to reuse proven terminal infrastructure while keeping Union's object model, ICM layer, adapter protocol and cross-system routing independent.

## Status

**v0 / experimental.** The architecture and first end-to-end ChatGPT relay are implemented, but the project still needs live-terminal testing on the target Mac, adapter hardening against ChatGPT DOM changes, richer file operations, semantic embeddings/model-backed classification, Hermes integration, and a real command palette.

## License

MIT
