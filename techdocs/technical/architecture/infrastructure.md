# Infrastructure Components

STRATO Mercata uses a microservices architecture with NGINX gateways, message queues, and multiple data stores.

## Service Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           External Traffic                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │highway-nginx│ │vault-nginx  │ │nginx-packager│
            │  (API GW)   │ │ (Key Mgmt)  │ │   (SMD)     │
            └─────────────┘ └─────────────┘ └─────────────┘
                    │               │               │
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ STRATO API  │ │   Vault     │ │  PostgREST  │
            │   /APEX     │ │  Service    │ │   (Cirrus)  │
            └─────────────┘ └─────────────┘ └─────────────┘
                    │               │               │
                    └───────────────┴───────────────┘
                                    │
                                    ▼
            ┌─────────────────────────────────────────────────────┐
            │                   Data Layer                        │
            │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
            │  │PostgreSQL│  │ LevelDB  │  │  Redis   │  Kafka   │
            │  └──────────┘  └──────────┘  └──────────┘          │
            └─────────────────────────────────────────────────────┘
```

## NGINX Gateways

### highway-nginx

Main API gateway for STRATO services.

**Features:**
- OAuth 2.0 / OpenID Connect authentication
- Request routing to backend services
- SSL/TLS termination
- Rate limiting
- CORS handling

**Configuration:**
```nginx
# highway-nginx/nginx.tpl.conf
upstream strato-api {
    server strato-api:3000;
}

upstream mercata-backend {
    server mercata-backend:3001;
}

server {
    listen 443 ssl;
    server_name ${NODE_HOST};
    
    # OAuth authentication via lua-resty-openidc
    access_by_lua_file /etc/nginx/openid.lua;
    
    location /strato/ {
        proxy_pass http://strato-api/;
    }
    
    location /api/ {
        proxy_pass http://mercata-backend/;
    }
}
```

### vault-nginx

Key management gateway with additional security.

**Features:**
- HSM integration support
- Key isolation
- Audit logging
- Certificate validation

**Endpoints:**
| Path | Description |
|------|-------------|
| `/vault/key` | Key generation/retrieval |
| `/vault/sign` | Transaction signing |
| `/vault/cert` | Certificate management |

### nginx-packager

SMD (STRATO Management Dashboard) gateway.

**Features:**
- CSRF protection (`csrf.lua`)
- Static file serving
- Swagger UI hosting
- Session management

**CSRF Protection:**
```lua
-- nginx-packager/csrf.lua
local token = ngx.var.cookie_csrf_token
local header_token = ngx.req.get_headers()["X-CSRF-Token"]

if ngx.req.get_method() ~= "GET" then
    if not token or token ~= header_token then
        ngx.exit(ngx.HTTP_FORBIDDEN)
    end
end
```

## Key Services

### PostgREST (postgrest-packager)

Automatic REST API generation from PostgreSQL schema.

**Features:**
- Auto-generated CRUD endpoints
- Filtering and pagination
- Row-level security
- OpenAPI schema generation

**Configuration:**
```conf
# postgrest-packager/postgrest.conf.tpl
db-uri = "postgres://user:pass@postgres:5432/cirrus"
db-schema = "public"
db-anon-role = "web_anon"
server-port = 3000
```

**Query Examples:**
```bash
# Get all tokens
GET /Token

# Filter by field
GET /Token?symbol=eq.USDC

# Pagination
GET /Token?limit=10&offset=0

# Ordering
GET /Token?order=created_at.desc
```

### Prometheus (prometheus-packager)

Metrics collection and monitoring.

**Metrics Collected:**
- Block height
- Transaction throughput
- API response times
- System resources
- Peer connections

**Configuration:**
```yaml
# prometheus-packager/strato_prometheus.yml
scrape_configs:
  - job_name: 'strato'
    static_configs:
      - targets: ['strato-api:3000']
    metrics_path: '/stats/prometheus'
    
  - job_name: 'nginx'
    static_configs:
      - targets: ['highway-nginx:9113']
```

### Vault Service (strato/vault)

Cryptographic key management.

**Components:**
- `server/`: Key storage and HSM interface
- `api/`: REST API definitions
- `client/`: Service client library

**Features:**
- Key generation (ECDSA, secp256k1)
- Transaction signing
- X.509 certificate management
- HSM integration (optional)

### Highway Service (strato/highway)

Permissioned network management.

**Components:**
- `server/`: Network registry
- `api/`: REST API definitions
- `client/`: Service client library

**Features:**
- Node registration
- Certificate authority
- Network topology management
- Validator set management

## Data Stores

### PostgreSQL (Cirrus)

Indexed blockchain data for efficient queries.

**Databases:**
| Database | Purpose |
|----------|---------|
| `eth` | Blockchain state (blocks, transactions) |
| `cirrus` | Contract state tables |

**Key Tables:**
```sql
-- Block information
CREATE TABLE block (
    number BIGINT PRIMARY KEY,
    hash TEXT,
    timestamp TIMESTAMP,
    proposer TEXT
);

-- Transaction history
CREATE TABLE transaction (
    hash TEXT PRIMARY KEY,
    block_number BIGINT,
    from_address TEXT,
    to_address TEXT,
    value TEXT,
    status TEXT
);

-- Contract state (auto-generated by Slipstream)
-- Each contract creates its own table
```

### LevelDB

Low-level blockchain state storage.

**Data Stored:**
- Account state (balance, nonce, code)
- Contract storage
- State trie nodes
- Code collection

### Redis

Caching and block database.

**Usage:**
- Block caching
- Transaction mempool
- Session data
- Peer state

### Kafka

Event streaming and message queue.

**Topics:**
| Topic | Purpose |
|-------|---------|
| `solidvmevents` | Smart contract events |
| `transactions` | Transaction propagation |
| `blocks` | Block announcements |

## Docker Compose

### Development Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  strato:
    image: blockapps/strato:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_HOST=localhost
      - NETWORK=helium
    volumes:
      - strato-data:/data
    depends_on:
      - postgres
      - redis
      - kafka

  postgres:
    image: postgres:14
    environment:
      - POSTGRES_DB=cirrus
    volumes:
      - pg-data:/var/lib/postgresql/data

  redis:
    image: redis:7
    volumes:
      - redis-data:/data

  kafka:
    image: confluentinc/cp-kafka:latest
    environment:
      - KAFKA_BROKER_ID=1
      - KAFKA_ZOOKEEPER_CONNECT=zookeeper:2181
    depends_on:
      - zookeeper

  zookeeper:
    image: confluentinc/cp-zookeeper:latest

volumes:
  strato-data:
  pg-data:
  redis-data:
```

### Production Templates

| Template | Description |
|----------|-------------|
| `docker-compose.tpl.yml` | Basic STRATO node |
| `docker-compose.allDocker.tpl.yml` | Full dockerized setup |
| `docker-compose.highway.tpl.yml` | With Highway service |
| `docker-compose.vault.tpl.yml` | With Vault service |
| `docker-compose.bridge.tpl.yml` | With Bridge service |

## SSL/TLS Configuration

### Certificate Setup

```bash
# bootstrap-docker/ssl/
ssl/
├── certs/
│   ├── server.crt      # Server certificate
│   └── ca.crt          # CA certificate
└── private/
    └── server.key      # Private key
```

### Replace Dummy Certificates

```bash
cd bootstrap-docker/ssl
./replace_dummy_cert /path/to/your/cert.pem /path/to/your/key.pem
```

## Environment Variables

### Required Variables

| Variable | Description |
|----------|-------------|
| `NODE_HOST` | Node hostname/IP |
| `NETWORK` | Network name (helium/upquark) |
| `OAUTH_CLIENT_ID` | OAuth client ID |
| `OAUTH_CLIENT_SECRET` | OAuth client secret |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_DEBUG_LOG` | false | Enable API debug logging |
| `VM_DEBUG_LOG` | false | Enable VM debug logging |
| `SLIPSTREAM_DEBUG_LOG` | false | Enable indexer debug logging |
| `FULL_DEBUG_LOG` | false | Enable all debug logging |

## Monitoring

### Health Endpoints

| Service | Endpoint | Description |
|---------|----------|-------------|
| STRATO API | `/health` | Node health status |
| Mercata Backend | `/api/health` | Backend health |
| APEX | `/_ping` | Simple ping |
| APEX | `/status` | Detailed status |

### Metrics Endpoints

| Service | Endpoint | Format |
|---------|----------|--------|
| STRATO | `/stats/prometheus` | Prometheus |
| STRATO | `/stats` | JSON |

## Related Documentation

- [Architecture Overview](README.md)
- [Getting Started](../getting-started.md)
- [STRATO API](strato-api.md)
