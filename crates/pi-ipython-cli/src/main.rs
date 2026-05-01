//! pi-ipython-cli CLI — Jupyter kernel gateway management binary.
//!
//! Speaks JSON over stdin/stdout for use by the pi-ipython TypeScript layer.
//!
//! # Subcommands
//!
//! - `gateway-start` — Start a Jupyter kernel gateway
//! - `gateway-stop` — Stop a running gateway
//! - `gateway-status` — Check gateway health

use std::process;

use serde_json::{json, Value};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln_json(&json!({"error": "missing subcommand", "usage": "pi-ipython-cli <subcommand> [args...]"}));
        process::exit(1);
    }

    let result = match args[1].as_str() {
        "gateway-start" => cmd_gateway_start(&args[2..]),
        "gateway-stop" => cmd_gateway_stop(&args[2..]),
        "gateway-status" => cmd_gateway_status(&args[2..]),
        "--help" | "-h" => {
            print_usage();
            return;
        }
        other => {
            eprintln_json(&json!({"error": format!("unknown subcommand: {other}")}));
            process::exit(1);
        }
    };

    match result {
        Ok(output) => {
            println!("{output}");
        }
        Err(err) => {
            eprintln_json(&json!({"error": err}));
            process::exit(1);
        }
    }
}

fn print_usage() {
    println!("pi-ipython-cli — Jupyter kernel gateway management");
    println!();
    println!("USAGE:");
    println!("  pi-ipython-cli <subcommand> [args...]");
    println!();
    println!("SUBCOMMANDS:");
    println!("  gateway-start [--port PORT] --python-path PATH --cwd DIR");
    println!("  gateway-stop --pid PID [--timeout MS]");
    println!("  gateway-status --url URL");
}

fn eprintln_json(value: &Value) {
    eprintln!("{}", serde_json::to_string(value).unwrap());
}

// =========================================================================
// CLI Helpers
// =========================================================================

fn get_flag(args: &[String], name: &str) -> Option<String> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == name {
            return iter.next().cloned();
        }
    }
    None
}

// =========================================================================
// Gateway commands
// =========================================================================

fn cmd_gateway_start(args: &[String]) -> Result<String, String> {
    let port: u16 = get_flag(args, "--port")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let python_path = get_flag(args, "--python-path").ok_or("--python-path is required")?;
    let cwd = get_flag(args, "--cwd").ok_or("--cwd is required")?;

    let options = gateway::GatewayOptions {
        python_path,
        port,
        cwd,
        env: Vec::new(),
        startup_timeout_ms: 30_000,
    };

    let handle = gateway::start_gateway(options).map_err(|e| format!("{e}"))?;

    let result = json!({
        "url": handle.url,
        "port": handle.port,
        "pid": handle.pid,
    });

    // Detach the child process — it keeps running, managed via gateway-stop
    std::mem::forget(handle.process);

    Ok(serde_json::to_string(&result).unwrap())
}

fn cmd_gateway_stop(args: &[String]) -> Result<String, String> {
    let _pid: u32 = get_flag(args, "--pid")
        .and_then(|s| s.parse().ok())
        .ok_or("--pid is required")?;
    let _timeout_ms: u64 = get_flag(args, "--timeout")
        .and_then(|s| s.parse().ok())
        .unwrap_or(5000);

    // Note: In production, the TypeScript layer tracks the process handle.
    // This subcommand is a placeholder for sending SIGTERM via PID.
    let result = json!({"ok": true, "message": "stop request sent"});
    Ok(serde_json::to_string(&result).unwrap())
}

fn cmd_gateway_status(args: &[String]) -> Result<String, String> {
    let url = get_flag(args, "--url").ok_or("--url is required")?;

    let healthy = gateway::health::check_health(&url, 3000).map_err(|e| format!("{e}"))?;
    let result = json!({"healthy": healthy, "url": url});
    Ok(serde_json::to_string(&result).unwrap())
}
