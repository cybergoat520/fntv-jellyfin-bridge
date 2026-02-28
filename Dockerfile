FROM rust:1.83-alpine AS builder

RUN apk add --no-cache musl-dev openssl-dev pkgconfig git

WORKDIR /app

RUN git clone --depth 1 https://github.com/notxx/fntv-jellyfin-bridge.git /tmp/repo && \
    cp -r /tmp/repo/bridge-rust/* /app/

RUN rm -f Cargo.lock && cargo build --release

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/target/release/fnos-bridge /usr/local/bin/fnos-bridge

VOLUME /app/web
EXPOSE 8096

CMD ["fnos-bridge"]
