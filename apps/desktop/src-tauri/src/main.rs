// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // `--mcp-stdio` / `--mcp-http [addr]` run the MCP server instead of the GUI,
    // so external MCP clients/agents can drive every capability.
    if args.iter().any(|a| a == "--mcp-stdio") {
        run_mcp_stdio();
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--mcp-http") {
        let addr = args.get(i + 1).cloned().unwrap_or_else(|| "127.0.0.1:8765".into());
        run_mcp_http(&addr);
        return;
    }
    srelens_desktop_lib::run();
}

fn run_mcp_http(addr: &str) {
    let addr: std::net::SocketAddr = addr.parse().expect("invalid --mcp-http address");
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");
    runtime.block_on(async {
        let registry = srelens_desktop_lib::build_registry();
        let server = srelens_mcp::McpServer::new(Arc::new(registry));
        eprintln!("MCP HTTP listening on http://{addr}/mcp (loopback; destructive tools need _confirm)");
        if let Err(e) = srelens_mcp::http::serve_http(server, addr).await {
            eprintln!("mcp http server error: {e}");
        }
    });
}

fn run_mcp_stdio() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");
    runtime.block_on(async {
        let registry = srelens_desktop_lib::build_registry();
        let server = srelens_mcp::McpServer::new(Arc::new(registry));
        let reader = tokio::io::BufReader::new(tokio::io::stdin());
        let writer = tokio::io::stdout();
        if let Err(e) = srelens_mcp::stdio::serve(server, reader, writer).await {
            eprintln!("mcp stdio server error: {e}");
        }
    });
}
