FROM oryd/kratos:v1.3.0 AS kratos
FROM oryd/hydra:v2.2.0 AS hydra

FROM alpine:3.20

ENV DSN=postgres://postgres@postgres:5432/kratos?sslmode=disable
ENV HYDRA_DSN=postgres://postgres@postgres:5432/hydra?sslmode=disable

# Install supervisor, utilities, and Node.js
RUN apk add --no-cache \
    supervisor \
    curl \
    ca-certificates \
    postgresql-client \
    nodejs \
    npm \
    bash

# Copy Kratos and Hydra binaries from official images
COPY --from=kratos /usr/bin/kratos /usr/bin/kratos
COPY --from=hydra /usr/bin/hydra /usr/bin/hydra

# Create directories
RUN mkdir -p /etc/config /app/login-ui /var/log/supervisor

# Copy configuration files
COPY kratos.yml /etc/config/kratos.yml
COPY hydra.yml /etc/config/hydra.yml
COPY identity.schema.json /etc/config/identity.schema.json

# Copy and install login UI
COPY login-ui /app/login-ui
WORKDIR /app/login-ui
RUN npm install --production

# Copy supervisor config
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose ports
# 4433 - Kratos public
# 4434 - Kratos admin
# 4444 - Hydra public
# 4445 - Hydra admin
# 3000 - Login UI
EXPOSE 4433 4434 4444 4445 3000

ENTRYPOINT ["/entrypoint.sh"]
