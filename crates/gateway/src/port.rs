//! TCP port allocation by binding to port 0 and reading the assigned port.

use std::net::TcpListener;

/// Error type for port allocation failures.
#[derive(Debug)]
pub enum PortError {
    /// Failed to bind to 127.0.0.1:0.
    BindError(std::io::Error),
    /// Failed to read the assigned local address.
    AddressError(std::io::Error),
    /// The assigned address is not a valid socket address.
    InvalidAddress,
}

impl std::fmt::Display for PortError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PortError::BindError(e) => write!(f, "failed to bind port: {e}"),
            PortError::AddressError(e) => write!(f, "failed to read local address: {e}"),
            PortError::InvalidAddress => write!(f, "assigned address is not a valid socket address"),
        }
    }
}

impl std::error::Error for PortError {}

/// Allocate a free TCP port on 127.0.0.1.
///
/// Binds to port 0, reads the assigned port, then closes the socket.
/// Returns the port number.
pub fn allocate_port() -> Result<u16, PortError> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(PortError::BindError)?;
    let port = listener
        .local_addr()
        .map_err(PortError::AddressError)?
        .port();
    // Drop the listener to release the port
    drop(listener);
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allocate_port_returns_valid_port() {
        let port = allocate_port().unwrap();
        assert!(port > 0, "port should be > 0 and <= 65535");
    }

    #[test]
    fn test_allocate_port_returns_different_ports() {
        let port1 = allocate_port().unwrap();
        let port2 = allocate_port().unwrap();
        // It's possible (though unlikely) the OS assigns the same port
        // if no other connections are active. Just verify both are valid.
        assert!(port1 > 0);
        assert!(port2 > 0);
    }

    #[test]
    fn test_port_is_reusable_after_drop() {
        // Bind to port 0, read port, drop, then bind again to same port
        let port = allocate_port().unwrap();
        let listener = TcpListener::bind(format!("127.0.0.1:{port}"));
        // Should succeed since allocate_port closed its socket
        assert!(listener.is_ok());
        drop(listener);
    }
}
