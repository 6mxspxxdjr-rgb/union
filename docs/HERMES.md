# Hermes Agent integration

Union can expose its currently connected browser-backed agents to Hermes Agent as delegated compute.

The integration is intentionally one-way at first:

\`\`\`text
Hermes Agent
    |
    | MCP stdio
    v
src/hermes-mcp.ts
    |
    | localhost HTTP
    v
Union dashboard/control server :7332
    |
    | normalized Union adapter calls
    v
ChatGPT / DeepSeek / future connected endpoints
\`\`\`

Hermes remains the planner. Union remains the local control plane. Connected agents remain independent compute endpoints.

## What Hermes gets

The Union MCP server exposes three tools:

- \`health\` — verify that the local Union process is reachable.
- \`list_agents\` — inspect connected Union endpoints and their current status.
- \`delegate\` — send a bounded task to a selected or automatically chosen endpoint and wait for its settled final response.

\`delegate\` accepts optional selectors for endpoint id, system, and title. Union serializes delegated work per endpoint so two callers do not intentionally dispatch into the same endpoint at the same time.

## Start Union

From the Union repository:

\`\`\`bash
bun install
bun run start
\`\`\`

The browser bridge remains on \`127.0.0.1:7331\`. The dashboard/control API remains on \`127.0.0.1:7332\`.

Connect or refresh the ChatGPT/DeepSeek browser tabs you want Union to use as compute.

Verify:

\`\`\`bash
curl http://127.0.0.1:7332/api/agents
\`\`\`

## Connect Hermes

Hermes has a native MCP client and can launch local stdio MCP servers.

Add Union to \`~/.hermes/config.yaml\` using the absolute path to this repository:

\`\`\`yaml
mcp_servers:
  union:
    command: "bun"
    args: ["/ABSOLUTE/PATH/TO/union/src/hermes-mcp.ts"]
    env:
      UNION_DASHBOARD_URL: "http://127.0.0.1:7332"
    timeout: 240
\`\`\`

Restart Hermes so it discovers the new MCP tools.

Depending on Hermes' tool naming layer, the tools may appear with an MCP server prefix such as \`mcp_union_list_agents\` and \`mcp_union_delegate\`.

## Example Hermes behavior

Ask Hermes:

\`\`\`text
Use Union to list the connected agents. Give the hardest architecture critique
subtask to an available ChatGPT endpoint, then use the returned answer as input
to your own final recommendation.
\`\`\`

The intended execution is:

1. Hermes calls \`list_agents\`.
2. Hermes chooses a suitable endpoint.
3. Hermes calls \`delegate\` with the subtask and endpoint id.
4. Union injects and submits the task into that endpoint.
5. Union waits for the provider's final settled answer.
6. The answer is returned to Hermes as the MCP tool result.
7. Hermes continues its own reasoning with that result.

## Direct control API

The MCP process is deliberately thin. It uses the same local API that other future controllers can use:

\`\`\`text
GET  /api/health
GET  /api/agents
POST /api/agents/spawn
POST /api/delegate
\`\`\`

Example direct delegation:

\`\`\`bash
curl -X POST http://127.0.0.1:7332/api/delegate \
  -H 'content-type: application/json' \
  -d '{
    "task": "Critique this architecture and identify the three highest-risk failure modes.",
    "system": "ChatGPT",
    "timeoutMs": 180000,
    "source": "manual"
  }'
\`\`\`

## Safety and concurrency behavior

- Control endpoints bind to \`127.0.0.1\`; this integration does not expose Union remotely.
- Offline endpoints are never selected.
- Union avoids endpoints that report \`working\` unless \`allowBusy=true\` is explicitly requested.
- Union keeps an in-process delegation lock per endpoint.
- Delegated calls use Union's existing settled-response detection rather than returning immediately after prompt injection.
- Maximum delegated task size is 250,000 characters.
- Delegation timeout is clamped to 5 seconds through 10 minutes.

## Next extension

This first pass exposes individual connected agents as compute. The next logical MCP tools are:

- \`run_workflow\` — let Hermes invoke a full Union node graph rather than one endpoint.
- \`get_run\` — poll or inspect a workflow run and its context packet.
- \`stop_run\` — cancel a Union workflow.
- capability-aware routing — select agents by declared capabilities instead of only provider/title.
- delegation budgets and queue policy — prevent runaway nested delegation when Hermes and Union workflows can call one another.


## Spawn fresh workers

Open a new background ChatGPT worker:

```bash
curl -X POST http://127.0.0.1:7332/api/agents/spawn \
  -H 'content-type: application/json' \
  -d '{"system":"ChatGPT","source":"manual"}'
```

Open a new DeepSeek worker by changing `system` to `DeepSeek`.

Delegate to a clean, isolated context:

```bash
curl -X POST http://127.0.0.1:7332/api/delegate \
  -H 'content-type: application/json' \
  -d '{
    "task": "Solve this independently.",
    "system": "ChatGPT",
    "freshSession": true,
    "timeoutMs": 180000,
    "source": "manual"
  }'
```

Use elastic capacity without always opening a tab:

```bash
curl -X POST http://127.0.0.1:7332/api/delegate \
  -H 'content-type: application/json' \
  -d '{
    "task": "Review this design.",
    "system": "DeepSeek",
    "spawnIfNeeded": true,
    "timeoutMs": 180000,
    "source": "manual"
  }'
```
