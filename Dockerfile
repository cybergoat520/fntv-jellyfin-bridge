FROM rust:1.83-alpine AS builder

# 网络重试设置
ENV CARGO_NET_RETRY=10
ENV CARGO_HTTP_TIMEOUT=300

RUN apk add --no-cache musl-dev openssl-dev pkgconfig git

WORKDIR /app

# 先下载依赖（利用 Docker 缓存层）
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

# 拉取真实代码
RUN git clone --depth 1 https://github.com/notxx/fntv-jellyfin-bridge.git /tmp/repo && \
    cp -r /tmp/repo/bridge-rust/* /app/

# 正式编译（保留 Cargo.lock）
RUN cargo build --release

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/target/release/fnos-bridge /usr/local/bin/fnos-bridge

VOLUME /app/web
EXPOSE 8096

CMD ["fnos-bridge"]
