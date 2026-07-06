<p align="center">
  <img src="docs/assets/logo-full.svg" alt="srelens" width="380" />
</p>

<h3 align="center">See everything. Break nothing.</h3>

<p align="center">
  A fast, lightweight Kubernetes IDE built with <a href="https://v2.tauri.app">Tauri v2</a> and a pure-Rust core —
  every backend capability is also exposed as an <a href="https://modelcontextprotocol.io">MCP</a> tool,
  so AI agents can drive your clusters through the same code paths as the UI.
</p>

<p align="center">
  <a href="https://srelens.com">Website</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#mcp-server">MCP server</a> ·
  <a href="docs/DEVELOPMENT.md">Developer guide</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img alt="Rust" src="https://img.shields.io/badge/core-100%25_Rust-8b5cf6">
  <img alt="Tauri v2" src="https://img.shields.io/badge/shell-Tauri_v2-e457c2">
  <img alt="MCP" src="https://img.shields.io/badge/agents-MCP_native-fb923c">
  <img alt="Status" src="https://img.shields.io/badge/status-v0.1_pre--release-675e80">
</p>

---

## Why srelens?

srelens is a desktop workspace for operating Kubernetes clusters, inspired by
[Lens](https://k8slens.dev)/[Freelens](https://github.com/freelensapp/freelens) but rebuilt
from scratch on a modern stack. Three ideas drive the project:

| | srelens | Electron-era Kubernetes IDEs |
|---|---|---|
| **Rendering** | OS system WebView via Tauri v2 | Bundled Chromium in every install |
| **Core runtime** | Pure Rust (`kube-rs`, `tokio`) — no Node.js | Node.js main process |
| **Cluster access** | Direct to the API server via `kube-rs` | Bundled `kubectl` + `helm` behind a proxy layer |
| **AI agents** | Built-in MCP server, every capability exposed | — |

**MCP-native by design** — every backend operation is declared once in a capability
registry and surfaced twice: as a Tauri command for the UI *and* as an MCP tool for
external agents (Claude, IDEs, automation). A CI completeness test guarantees the two
surfaces never drift.

## Features

- **Multi-cluster workspace** — kubeconfig discovery (including additional files and pasted configs), context switching, cluster hotbar, per-context avatars and colors.
- **Live resource browsing** — 40+ resource kinds across workloads, networking, storage, RBAC, and custom resources (CRDs), with server-side watches streaming into the UI — no polling.
- **Resource detail & YAML** — manifest view, schema-aware YAML editing (CodeMirror) with validation and apply, resource events, workload relations.
- **Operations** — scale, rollout restart, delete/evict pods, cordon/drain nodes, port-forward management — every destructive action gated behind confirmation.
- **Pod terminal & logs** — interactive `exec` sessions (xterm.js) and live log streaming with follow.
- **Helm** — browse installed releases and inspect release details.
- **Metrics** — node and pod metrics (metrics-server) with usage overviews and sparklines.
- **Command palette** — `⌘K` keyboard-first navigation across contexts, resources, and actions.
- **Local-first** — talks directly to your API servers with your kubeconfig credentials. No cloud service in between.

## MCP server

The same binary that runs the GUI can run as an MCP server, exposing the full capability registry:

```sh
# stdio transport (for local agents / IDE clients)
srelens-desktop --mcp-stdio

# HTTP transport (loopback only, default 127.0.0.1:8765)
srelens-desktop --mcp-http [addr]
```

Destructive tools (delete, drain, apply, …) carry annotations and require an explicit
`_confirm` argument — an agent can't delete or drain anything without approval.

Example Claude Desktop / MCP client config:

```json
{
  "mcpServers": {
    "srelens": {
      "command": "/path/to/srelens-desktop",
      "args": ["--mcp-stdio"]
    }
  }
}
```

## Quick start

Prerequisites: [Rust](https://rustup.rs) (stable), [Node.js](https://nodejs.org) 22+,
[pnpm](https://pnpm.io) 9+, and the
[Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your platform.

```sh
pnpm install
pnpm dev          # launches the desktop app with hot reload
```

Other useful commands:

```sh
pnpm test         # all JS/TS tests (Vitest, with coverage)
cargo test        # all Rust tests
pnpm build        # production frontend build
pnpm tauri build  # packaged desktop binaries
```

See the [developer guide](docs/DEVELOPMENT.md) for architecture, testing standards,
and how to add a new capability.

## Repository layout

```
apps/desktop/            Tauri app
  src/                   React 19 + TypeScript UI (shadcn/radix, MobX, xterm, CodeMirror)
  src-tauri/             Rust backend: commands, streams, capability registration
crates/
  capability/            Capability registry — single source of truth for backend ops
  kube/                  Kubernetes integration (kubeconfig, watches, actions, helm, metrics)
  mcp/                   MCP server (stdio + HTTP) generated from the registry
docs/                    Project documentation + brand assets
```

## Project status

srelens is in **early, active development** (v0.1 pre-release). The read/browse/operate
core described above works end-to-end; extension support, broader resource coverage, and
packaging polish are on the roadmap. Expect breaking changes.

Installers aren't published yet — build from source with the quick start above, and star
the repo to hear when signed builds land.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

---

<p align="center">
  <sub>Not affiliated with Mirantis (Lens) or the Freelens project.</sub>
</p>
