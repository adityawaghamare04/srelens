<p align="center">
  <img src="docs/assets/logo-full.svg" alt="srelens" width="380" />
</p>

<h3 align="center">The Kubernetes control room—built in Rust, ready for engineers and AI agents.</h3>

<p align="center">
  srelens is an open-source, local-first Kubernetes desktop workspace for SREs,
  platform engineers, and DevOps engineers. Investigate, analyse, and take safe
  action across clusters from one application built with Tauri v2, React 19,
  and a pure-Rust core.
</p>

<p align="center">
  <a href="https://srelens.com">Website</a> ·
  <a href="#install">Install</a> ·
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
  <img alt="Rust core" src="https://img.shields.io/badge/core-Rust-8b5cf6">
  <img alt="Tauri v2" src="https://img.shields.io/badge/desktop-Tauri_v2-e457c2">
  <img alt="MCP server" src="https://img.shields.io/badge/agents-MCP-fb923c">
  <img alt="Project status: beta" src="https://img.shields.io/badge/status-beta-f59e0b">
</p>

---

## Why srelens?

Kubernetes troubleshooting often means moving between terminals, dashboards, YAML
editors, logs, and cluster contexts. srelens brings that investigation loop into
one local-first desktop workspace.

- **One workspace from investigation to action** — browse resources, inspect events
  and YAML, follow logs, use terminals, manage port forwards, and take cluster
  actions without constantly switching tools.
- **Built for engineers and AI agents** — supported backend capabilities are also
  available through the built-in MCP server.
- **Local-first cluster access** — srelens uses credentials from your local
  kubeconfig and connects directly to Kubernetes API servers, without routing
  cluster access through a srelens cloud service.
- **Safe operations** — destructive actions are identified and confirmation-gated.
- **Open source** — licensed under MIT, with public code, releases, issues, and
  roadmap on GitHub.

srelens uses the operating system WebView through Tauri v2 and a Rust backend built
with `kube-rs` and `tokio`. It is independently developed and is not affiliated with
Mirantis Lens or the Freelens project.

## Features

- **Multi-cluster workspace** — discover kubeconfig contexts, add additional files,
  paste configurations, customise profiles, and move between clusters with the
  cluster hotbar.
- **Live Kubernetes resources** — browse workloads, networking, storage, RBAC,
  admission, autoscaling, and custom resources with live watch updates.
- **Resource details and YAML** — inspect manifests, events, relationships, and
  schema-aware YAML with validation and apply workflows.
- **Logs and pod terminals** — stream logs and open interactive container sessions
  directly beside the resource you are investigating.
- **Port forwarding** — create, inspect, and manage active forwards from the desktop
  workspace.
- **Helm views** — browse installed releases and inspect release details.
- **Metrics** — inspect node and pod CPU and memory data when `metrics-server` is
  available.
- **Operational actions** — scale workloads, restart rollouts, evict or delete pods,
  and cordon or drain nodes with confirmation gates for destructive actions.
- **Command palette** — use keyboard-first navigation across contexts, resources,
  and supported actions.
- **MCP access** — expose supported backend capabilities to MCP-capable clients over
  stdio or loopback HTTP.
- **Local terminal workflows** — use `kubectl` and other installed command-line tools
  from the built-in local terminal when needed.

## Install

Download the latest beta for your platform from
[GitHub Releases](https://github.com/srelens/srelens/releases/latest).

| Platform | Packages | Notes |
| --- | --- | --- |
| macOS | `.dmg` for Apple Silicon and Intel | Developer ID signed and notarized |
| Linux | `.AppImage`, `.deb`, `.rpm` | AppImage supports the in-app updater |
| Windows | `.exe`, `.msi` | Windows may show a SmartScreen prompt while code signing remains on the roadmap |

See the [installation guide](docs/INSTALL.md) for platform-specific installation,
first-launch, updating, verification, and uninstall instructions.

## MCP server

srelens includes an MCP server generated from the same capability registry used by
the desktop backend. Supported backend capabilities can therefore be used by
MCP-capable clients without creating a separate cluster integration layer.

Open **Settings → MCP** to:

- run the MCP server over loopback HTTP;
- install the `srelens` CLI for stdio connections;
- copy client configuration for supported MCP clients.

You can also start the server directly:

```sh
srelens --mcp-stdio
srelens --mcp-http 127.0.0.1:8765
```

Mutating tools require an explicit `_confirm: true` argument before they run.

Example stdio configuration:

```json
{
  "mcpServers": {
    "srelens": {
      "command": "srelens",
      "args": ["--mcp-stdio"]
    }
  }
}
```

> MCP access uses your locally authenticated cluster contexts. Review tool calls
> and use appropriate Kubernetes RBAC permissions, especially with critical
> clusters.

## Quick start

### Prerequisites

- [Rust](https://rustup.rs) stable
- [Node.js](https://nodejs.org) 22+
- [pnpm](https://pnpm.io) 9+
- [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/)
- A reachable Kubernetes cluster for cluster-dependent workflows

### Run locally

```sh
git clone https://github.com/srelens/srelens
cd srelens
pnpm install
pnpm dev
```

### Useful commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Launch the desktop application in development mode |
| `pnpm test` | Run JavaScript and TypeScript tests |
| `cargo test` | Run Rust workspace tests |
| `pnpm build` | Build the production frontend |
| `pnpm tauri build` | Create packaged desktop binaries |

See the [developer guide](docs/DEVELOPMENT.md) for architecture, testing standards,
and instructions for adding capabilities.

## Architecture

```text
React 19 + TypeScript
        │
        │ Tauri commands and events
        ▼
Tauri v2 desktop shell
        │
        ▼
Pure-Rust backend
├── capability registry
├── Kubernetes integration with kube-rs
├── live watches, logs, exec, and port forwarding
├── Helm and metrics
└── MCP server over stdio and loopback HTTP
```

Repository layout:

```text
apps/desktop/
  src/                   React and TypeScript desktop UI
  src-tauri/             Tauri application and Rust command bridge
crates/
  capability/            Backend capability registry
  kube/                  Kubernetes clients, watches, actions, Helm, and metrics
  mcp/                   MCP server
docs/                    Installation, development, and project documentation
```

## Project status

srelens is currently in **beta**. It is ready for evaluation and everyday testing,
but users should review release notes and take extra care when using it with
critical clusters.

Breaking changes may still occur before a stable release. Feedback, bug reports,
and reproducible troubleshooting details are welcome.

- [Latest release](https://github.com/srelens/srelens/releases/latest)
- [All releases](https://github.com/srelens/srelens/releases)
- [Issues and roadmap](https://github.com/srelens/srelens/issues)

## Contributing

Contributions are welcome. Start with:

- [Contribution guide](CONTRIBUTING.md)
- [Developer guide](docs/DEVELOPMENT.md)
- [Open issues](https://github.com/srelens/srelens/issues)

Please review the [Code of Conduct](.github/CODE_OF_CONDUCT.md) before
participating.

## License

srelens is open source under the [MIT License](LICENSE).

---

<p align="center">
  <sub>Not affiliated with Mirantis Lens or the Freelens project.</sub>
</p>
