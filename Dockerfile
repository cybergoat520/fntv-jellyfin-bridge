FROM rust:1.85-alpine AS builder

# 网络重试设置
ENV CARGO_NET_RETRY=10
ENV CARGO_HTTP_TIMEOUT=300

RUN apk add --no-cache musl-dev openssl-dev pkgconfig git

# 拉取代码
RUN git clone --depth 1 https://github.com/notxx/fntv-jellyfin-bridge.git /tmp/repo

# 在代码目录构建
WORKDIR /tmp/repo/bridge-rust
RUN cargo build --release

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /tmp/repo/bridge-rust/target/release/fnos-bridge /usr/local/bin/fnos-bridge

VOLUME /app/web
EXPOSE 8096

CMD ["fnos-bridge"]
