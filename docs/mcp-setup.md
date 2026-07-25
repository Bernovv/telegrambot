# MCP Setup

## Current Session

- Supabase MCP: connected and read-only documentation search was verified.
- Railway MCP: connected and authenticated.
- GitHub MCP: connected and read access was verified against a public repository.

## Context7

Context7 was not exposed as a callable tool in this session. Recommended Codex setup:

```bash
codex mcp add context7 -- npx -y @upstash/context7-mcp
```

If using an API key, store it outside the repository in the user's Codex config or secret manager. Do not commit it.

## Graphify

Graphify was installed locally into `Project/.tools/graphify` and excluded from Git and Graphify scans.

The current graph was generated in code-only mode:

```bash
PYTHONPATH=Project/.tools/graphify python -m graphify extract Project --code-only --no-cluster
```

Generated artifact:

```text
graphify-out/
  graph.json
```

Graphify query was verified against `graphify-out/graph.json`.

Before using Graphify, keep `.graphifyignore` in place and never include secrets, production DSNs, PII exports, raw payment payloads, backups, or generated tickets.
