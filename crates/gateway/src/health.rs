//! Health check for the Jupyter kernel gateway.
//!
//! Checks gateway availability by querying `/api/kernelspecs`.

use std::time::Duration;

/// Error type for health check failures.
#[derive(Debug)]
pub enum HealthError {
    /// HTTP request failed (connection refused, timeout, etc.)
    RequestFailed(String),
    /// Non-OK HTTP status code.
    BadStatus(u16),
}

impl std::fmt::Display for HealthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HealthError::RequestFailed(msg) => write!(f, "health check request failed: {msg}"),
            HealthError::BadStatus(code) => write!(f, "health check returned status {code}"),
        }
    }
}

impl std::error::Error for HealthError {}

/// Perform a single health check against the gateway.
///
/// Returns `Ok(true)` if the gateway responds with 2xx to `/api/kernelspecs`.
/// Returns `Ok(false)` if the connection is refused (not yet ready).
/// Returns `Err` for unexpected errors.
pub fn check_health(url: &str, timeout_ms: u64) -> Result<bool, HealthError> {
    let specs_url = format!("{}/api/kernelspecs", url.trim_end_matches('/'));
    let timeout = Duration::from_millis(timeout_ms);

    let result = ureq::get(&specs_url)
        .config()
        .timeout_global(Some(timeout))
        .build();

    match result.call() {
        Ok(response) => {
            let status: u16 = response.status().into();
            if status >= 200 && status < 300 {
                Ok(true)
            } else {
                Err(HealthError::BadStatus(status))
            }
        }
        Err(ureq::Error::StatusCode(code)) => {
            Err(HealthError::BadStatus(code))
        }
        Err(ureq::Error::ConnectionFailed) => {
            // Connection refused = not ready yet
            Ok(false)
        }
        Err(ureq::Error::Timeout(_)) => {
            // Timeout = not ready yet
            Ok(false)
        }
        Err(e) => {
            // Try matching other transport-like errors
            let msg = format!("{e}");
            if msg.contains("Connection refused") {
                Ok(false)
            } else {
                Err(HealthError::RequestFailed(msg))
            }
        }
    }
}

/// Poll health check with exponential backoff until success or timeout.
///
/// Starts at 100ms, doubles up to 2s max, capped at `timeout_ms` total.
pub fn retry_health(url: &str, timeout_ms: u64) -> Result<bool, HealthError> {
    let start = std::time::Instant::now();
    let mut delay_ms: u64 = 100;
    let max_delay_ms: u64 = 2000;

    loop {
        match check_health(url, timeout_ms) {
            Ok(true) => return Ok(true),
            Ok(false) => {
                // Not ready yet, wait and retry
            }
            Err(e) => {
                // Unexpected error
                return Err(e);
            }
        }

        if start.elapsed().as_millis() as u64 >= timeout_ms {
            return Ok(false);
        }

        std::thread::sleep(Duration::from_millis(delay_ms));
        delay_ms = std::cmp::min(delay_ms * 2, max_delay_ms);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_check_refused() {
        // A port that almost certainly has nothing listening
        let result = check_health("http://127.0.0.1:1", 500);
        match result {
            Ok(healthy) => assert!(!healthy),
            Err(_) => {} // Some systems may block port 1, that's ok
        }
    }
}
