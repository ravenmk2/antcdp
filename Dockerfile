FROM alpine:3.24.2

RUN apk add --no-cache ca-certificates \
    && addgroup -g 10001 antcdp \
    && adduser -D -u 10001 -G antcdp antcdp \
    && mkdir -p /app/data \
    && chmod 700 /app/data \
    && chown -R antcdp:antcdp /app

WORKDIR /app
COPY --chmod=0555 --chown=antcdp:antcdp antcdp /app/antcdp

USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/antcdp"]
CMD ["serve"]
