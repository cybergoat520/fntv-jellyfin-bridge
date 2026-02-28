# Stage 1: Build Rust binary
FROM rust:1.88-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# Clone and build
RUN git clone --depth 1 https://github.com/notxx/fntv-jellyfin-bridge.git /tmp/repo && \
    cp -r /tmp/repo/bridge-rust/* /app/
RUN cargo build --release

# Stage 2: Create minimal runtime image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/fnos-bridge /usr/local/bin/fnos-bridge

VOLUME /app/web
EXPOSE 8096

CMD ["fnos-bridge"]
