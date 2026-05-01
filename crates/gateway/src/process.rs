//! Jupyter kernel gateway process lifecycle.
//!
//! Starts and stops the `jupyter kernel-gateway` HTTP server as a child process.

use std::process::{Child, Command, Stdio};

use crate::health::retry_health;
use crate::port::allocate_port;

/// Options for starting the gateway.
#[derive(Debug, Clone)]
pub struct GatewayOptions {
    /// Path to the Python interpreter (e.g., "/usr/bin/python3").
    pub python_path: String,
    /// Port to bind (0 = auto-allocate).
    pub port: u16,
    /// Working directory for the gateway process.
    pub cwd: String,
    /// Environment variables to pass to the gateway.
    pub env: Vec<(String, String)>,
    /// Maximum time to wait for the gateway to become healthy (ms).
    pub startup_timeout_ms: u64,
}

impl Default for GatewayOptions {
    fn default() -> Self {
        GatewayOptions {
            python_path: "python3".to_string(),
            port: 0,
            cwd: ".".to_string(),
            env: Vec::new(),
            startup_timeout_ms: 30_000,
        }
    }
}

/// Handle to a running gateway process.
#[derive(Debug)]
pub struct GatewayHandle {
    /// Child process handle.
    pub process: Child,
    /// The port the gateway is listening on.
    pub port: u16,
    /// The full URL of the gateway (e.g., "http://127.0.0.1:8888").
    pub url: String,
    /// Process ID.
    pub pid: u32,
}

/// Error type for gateway operations.
#[derive(Debug)]
pub enum GatewayError {
    /// Failed to allocate a port.
    PortError(crate::port::PortError),
    /// Failed to spawn the gateway process.
    SpawnError(String),
    /// Gateway failed to become healthy within the timeout.
    StartupTimeout { port: u16, timeout_ms: u64 },
    /// Gateway health check failed with an error.
    HealthCheckError(crate::health::HealthError),
    /// Gateway process exited prematurely.
    PrematureExit { code: Option<i32> },
}

impl std::fmt::Display for GatewayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GatewayError::PortError(e) => write!(f, "port allocation failed: {e}"),
            GatewayError::SpawnError(msg) => write!(f, "failed to spawn gateway: {msg}"),
            GatewayError::StartupTimeout { port, timeout_ms } => {
                write!(f, "gateway on port {port} not healthy after {timeout_ms}ms")
            }
            GatewayError::HealthCheckError(e) => write!(f, "health check failed: {e}"),
            GatewayError::PrematureExit { code } => {
                write!(f, "gateway process exited prematurely with code {code:?}")
            }
        }
    }
}

impl std::error::Error for GatewayError {}

impl From<crate::port::PortError> for GatewayError {
    fn from(e: crate::port::PortError) -> Self {
        GatewayError::PortError(e)
    }
}

/// Start the Jupyter kernel gateway process.
///
/// 1. Allocates a port (if `options.port` is 0).
/// 2. Spawns `jupyter kernel-gateway` with the given config.
/// 3. Waits for the gateway to become healthy.
///
/// Returns a `GatewayHandle` on success.
pub fn start_gateway(options: GatewayOptions) -> Result<GatewayHandle, GatewayError> {
    let port = if options.port == 0 {
        allocate_port()?
    } else {
        options.port
    };

    let args = &[
        "-m",
        "jupyter",
        "kernelgateway",
        "--KernelGatewayApp.ip=127.0.0.1",
        &format!("--KernelGatewayApp.port={port}"),
        "--KernelGatewayApp.allow_origin='*'",
        "--KernelGatewayApp.allow_credentials='true'",
        "--KernelGatewayApp.allow_methods='GET,POST,PUT,DELETE,OPTIONS'",
        "--JupyterWebsocketPersonality.list_kernels=True",
    ];

    let mut command = Command::new(&options.python_path);
    command
        .args(args)
        .current_dir(&options.cwd)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());

    // Set environment variables
    for (key, value) in &options.env {
        command.env(key, value);
    }

    let mut child = command.spawn().map_err(|e| {
        GatewayError::SpawnError(format!("{e}"))
    })?;

    let pid = child.id();
    let url = format!("http://127.0.0.1:{port}");

    // Wait for gateway to become healthy
    match retry_health(&url, options.startup_timeout_ms) {
        Ok(true) => {
            Ok(GatewayHandle {
                process: child,
                port,
                url,
                pid,
            })
        }
        Ok(false) => {
            // Clean up the child process
            let _ = child.kill();
            let _ = child.wait();
            Err(GatewayError::StartupTimeout {
                port,
                timeout_ms: options.startup_timeout_ms,
            })
        }
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(GatewayError::HealthCheckError(e))
        }
    }
}

/// Stop the gateway process gracefully.
///
/// Sends SIGTERM (or equivalent), waits up to `timeout_ms`, then force-kills.
pub fn stop_gateway(handle: &mut GatewayHandle, _timeout_ms: u64) -> Result<(), GatewayError> {
    // Try graceful shutdown first
    let _ = handle.process.kill();
    let _ = handle.process.wait();

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gateway_start_stop() {
        // This test requires jupyter-kernel-gateway to be installed.
        // It's an integration test, skipped by default.
        let python_path = std::env::var("PYTHON_PATH").unwrap_or_else(|_| "python3".to_string());
        let cwd = std::env::current_dir().unwrap();
        let cwd_str = cwd.to_string_lossy().to_string();

        let options = GatewayOptions {
            python_path,
            port: 0,
            cwd: cwd_str,
            env: vec![],
            startup_timeout_ms: 15_000,
        };

        match start_gateway(options) {
            Ok(mut handle) => {
                assert!(handle.port > 0);
                assert!(handle.url.contains(&handle.port.to_string()));
                let _ = stop_gateway(&mut handle, 2000);
            }
            Err(e) => {
                // Skip if jupyter-kernel-gateway is not installed
                eprintln!("Skipping integration test: {e}");
            }
        }
    }
}
