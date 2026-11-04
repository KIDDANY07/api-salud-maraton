FROM quay.io/keycloak/keycloak:26.4.2 AS builder
ENV KC_DB=postgres
ENV KC_HEALTH_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.4.2
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY realm-export.json /opt/keycloak/data/import/realm-export.json
ENV KC_HTTP_ENABLED=true
ENV KC_PROXY_HEADERS=xforwarded
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "-c", "exec /opt/keycloak/bin/kc.sh start --optimized --import-realm --http-port=\"${PORT:-8080}\""]
