# Contributing to SRELens

Thanks for your interest! SRELens is in early, active development, so expect fast movement and breaking changes.

## Setup

Follow the [developer guide](docs/DEVELOPMENT.md) — it covers prerequisites, running the app, architecture, and the capability-registry pattern that almost every change touches.

## Ground rules

1. **Test-driven development is mandatory.** Every change starts with a failing test. No implementation lands without one.
2. **Coverage floor is 85%** (lines) in both Rust and TypeScript, enforced as a hard CI gate.
3. **Every backend operation must be a capability.** Register it once in `capabilities.rs`; the MCP surface is generated and verified automatically.
4. **Destructive operations must be annotated** (`destructive`, `requires_confirm`) so both UI confirmations and MCP tool hints stay correct.

## Before opening a PR

```sh
cargo test
cargo llvm-cov --workspace --fail-under-lines 85
pnpm test
```

All three must pass locally. Keep PRs focused — one logical change per PR, with a description of what and why.
