# The release build embeds web/dist in antcdp before creating the runtime image.
FROM alpine:3.24.2

RUN apk add --no-cache ca-certificates \
    && addgroup -g 10001 antcdp \
    && adduser -D -u 10001 -G antcdp antcdp \
    && mkdir -p /app/conf /app/data \
    && chmod 0755 /app/conf \
    && chmod 700 /app/data \
    && chown antcdp:antcdp /app/data

WORKDIR /app
COPY --chmod=0555 antcdp /app/antcdp

USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/antcdp"]
CMD ["serve"]
