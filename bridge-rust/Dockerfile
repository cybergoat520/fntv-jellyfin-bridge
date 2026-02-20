# Stage 1: Build Rust binary
FROM rust:1.85-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
# Pre-build dependencies (cache layer)
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release

# Stage 2: Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/fnos-bridge /usr/local/bin/fnos-bridge

# jellyfin-web 通过卷挂载到 /app/web
VOLUME /app/web

ENV BRIDGE_PORT=8096
EXPOSE 8096

CMD ["fnos-bridge"]
