// # Performs a dependency-free HTTP health probe for the distroless gateway image.
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

fn main() {
    let address = std::env::var("LLE_HEALTH_BIND")
        .unwrap_or_else(|_| "127.0.0.1:9100".to_owned())
        .parse::<SocketAddr>()
        .unwrap_or_else(|_| std::process::exit(1));
    let probe = SocketAddr::new(
        if address.ip().is_unspecified() {
            "127.0.0.1".parse().expect("loopback address parses")
        } else {
            address.ip()
        },
        address.port(),
    );
    let mut stream = TcpStream::connect_timeout(&probe, Duration::from_secs(2))
        .unwrap_or_else(|_| std::process::exit(1));
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap_or_else(|_| std::process::exit(1));
    stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .unwrap_or_else(|_| std::process::exit(1));
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .unwrap_or_else(|_| std::process::exit(1));
    if !response.starts_with("HTTP/1.1 200") && !response.starts_with("HTTP/1.0 200") {
        std::process::exit(1);
    }
}
