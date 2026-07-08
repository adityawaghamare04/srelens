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
  <a href="https://github.com/srelens/srelens/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/srelens/srelens?display_name=release&label=release&color=22c55e"></a>
  <a href="https://github.com/srelens/srelens/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/srelens/srelens/total?label=downloads&color=3b82f6"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/srelens/srelens?color=675e80"></a>
</p>

<p align="center">
  <img alt="Rust" src="https://img.shields.io/badge/core-100%25_Rust-8b5cf6">
  <img alt="Tauri v2" src="https://img.shields.io/badge/shell-Tauri_v2-e457c2">
  <img alt="MCP" src="https://img.shields.io/badge/agents-MCP_native-fb923c">
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
- **MCP-native** — every capability is also an MCP tool; enable the server and copy client config from **Settings → MCP** (see below).
- **Local-first** — talks directly to your API servers with your kubeconfig credentials. No cloud service in between.

## MCP server

srelens is MCP-native — every capability it exposes to the UI is also an MCP tool, so
agents and MCP-enabled editors can drive your clusters. Set it up in **Settings → MCP**:

- **Run the MCP server (HTTP)** — toggle a loopback server (default `127.0.0.1:8765`) that
  shares the app's authenticated clusters, so a client sees exactly what you do.
- **Install the srelens CLI** — adds a `srelens` command to `~/.local/bin` so clients can
  spawn `srelens --mcp-stdio` (make sure `~/.local/bin` is on your `PATH`).
- **Client config** — copy ready-made config for Claude Code, Claude Desktop, Cursor,
  Codex, Antigravity, and generic clients.

Or run the server directly from a terminal:

```sh
srelens --mcp-stdio                 # stdio (agents / IDE clients spawn this)
srelens --mcp-http 127.0.0.1:8765   # loopback HTTP
```

Destructive tools (delete, drain, apply, …) are annotated and require an explicit
`_confirm` argument — an agent can't delete or drain anything without approval.

Example client config (stdio):

```json
{
  "mcpServers": {
    "srelens": { "command": "srelens", "args": ["--mcp-stdio"] }
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

Signed builds for macOS (Apple Silicon + Intel), Linux (AppImage/deb/rpm), and Windows
are on the [latest release](https://github.com/srelens/srelens/releases/latest); the app
updates itself from there. See the [install guide](docs/INSTALL.md) for per-platform steps,
or the [quick start](#quick-start) to build from source.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) to get started.
Please also review our [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## License

srelens is open source under the [MIT License](LICENSE).

---

<p align="center">
  <sub>Not affiliated with Mirantis (Lens) or the Freelens project.</sub>
</p>
