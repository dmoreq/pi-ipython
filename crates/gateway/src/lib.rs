//! Jupyter kernel gateway process lifecycle management.
//!
//! Manages the lifecycle of the `jupyter-kernel-gateway` process:
//! - Port allocation
//! - Process start/stop/monitor
//! - Health check via `/api/kernelspecs`

pub mod health;
pub mod port;
pub mod process;

pub use health::{check_health, retry_health, HealthError};
pub use port::allocate_port;
pub use process::{start_gateway, stop_gateway, GatewayError, GatewayHandle, GatewayOptions};
