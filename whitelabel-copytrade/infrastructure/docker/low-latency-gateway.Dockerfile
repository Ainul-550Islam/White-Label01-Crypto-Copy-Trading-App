# # Multi-stage locked Rust release build; runtime contains only non-root binaries and trusted CA roots.
FROM rust:1.88.0-bookworm AS build
WORKDIR /src
COPY services/low-latency-gateway/Cargo.toml services/low-latency-gateway/Cargo.lock ./services/low-latency-gateway/
COPY services/low-latency-gateway/src ./services/low-latency-gateway/src
COPY services/low-latency-gateway/integration ./services/low-latency-gateway/integration
WORKDIR /src/services/low-latency-gateway
RUN cargo build --release --locked --bin low-latency-gateway --bin gateway-healthcheck

FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /src/services/low-latency-gateway/target/release/low-latency-gateway /app/low-latency-gateway
COPY --from=build --chown=nonroot:nonroot /src/services/low-latency-gateway/target/release/gateway-healthcheck /app/gateway-healthcheck
ENV LLE_ENVIRONMENT=production \
    LLE_HEALTH_BIND=0.0.0.0:9100 \
    LLE_TRANSPORT_BIND=0.0.0.0:9101
EXPOSE 9100 9101
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 CMD ["/app/gateway-healthcheck"]
USER nonroot:nonroot
ENTRYPOINT ["/app/low-latency-gateway"]
