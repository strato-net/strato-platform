# Vault Runner

- This is a simple example of how to run and manage a local Vault
- It's deploying the Vault on plain HTTP, so it's only acceptable for using within one secure host.
- It is using a specific version of docker-compose.vault.yml with prebuilt images to avoid building from source and installing all build dependencies

If you still want to build from source:
```
cd strato-platform
./install_deps.sh
make vault-wrapper vault-nginx docker-compose
cp docker-compose.vault.yml strato/vault/vault-runner/
```

### Prerequisites

- Docker with Compose v2

### Run

```
cd strato-platform/strato/vault/vault-runner
./run-vault.sh
# > Enter vault password when prompted
```

### Configure your local STRATO with the local vault

When starting a local STRATO node, provide the following flag in your `strato-up` command:
```
strato-up mynode \
  <...> \
  --vaultUrl=http://$(hostname):8080/strato/v2.3 \
```

### Run with SSL (cluster env etc.)

1. Create vault-runner/ssl/ directory with structure:
    - ssl/
      - certs/
        - server.pem
      - private/
        - server.key
2. Update run-vault.sh to use `ssl=true`, and replace `HTTP_PORT=8080` with `HTTPS_PORT=8443`
3. STRATO configuration should use the https url with domain of the SSL cert, e.g.:
   - `--vaultUrl=https://example.com:8443/strato/v2.3 \`
4. Make sure the domain and port are accessible from the STRATO node's host.

### Key migration

You may want to migrate a specific user's key from one Vault instance to another (for example,
from the BlockApps shared Vault to your local vault). See the
[Migrating a single key between Vaults](#migrating-a-single-key-between-vaults) section below.

### Killing the Vault

- To bring down but keep database:
    ```
    docker compose -f docker-compose.vault.yml -p vault down
    ```
- To wipe the vault:
    ```
    docker compose -f docker-compose.vault.yml -p vault down -vt0
    ```


---


## Changing the existing Vault password

This is an example process to update the Vault password with minimal (2-3 seconds) downtime. The process requires decrypting and re-encrypting the values in database. Proceed carefully.

### Build and prepare

Build on Ubuntu 24.04 to match the vault-wrapper container's base image (for dynamicly linked libraries to work).
```
set -e
make change-vault-password
sudo docker cp ~/.local/bin/change-vault-password vault-vault-wrapper-1:/usr/local/bin/change-vault-password
sudo docker exec vault-vault-wrapper-1 chmod 755 /usr/local/bin/change-vault-password
```

### Backup DB
```
sudo docker exec vault-postgres-1   pg_dump -U postgres -d oauth -F p   > ~/vault-$(date -u +%F-%H%M%S).sql
```

### Execute the password change

Create the update-password.sh (don't run commands directly):
```
#!/bin/bash
set -e

OLD_PASSWORD=myoldpassword
NEW_PASSWORD=mynewpassword

sudo docker exec -i \
  -e OLD_VAULT_PASSWORD="${OLD_PASSWORD}" \
  -e NEW_VAULT_PASSWORD="${NEW_PASSWORD}" \
  vault-vault-wrapper-1 \
  /usr/local/bin/change-vault-password \
    --pghost=postgres --pgport=5432 \
    --pguser=postgres --password=api --database=oauth
#
sudo docker restart -t 0 vault-vault-wrapper-1
for i in {1..200}; do
  if curl --fail -sS -o /dev/null --insecure https://localhost:8093/ping 2>/dev/null; then
    break
  fi
done
sudo docker exec -i vault-vault-wrapper-1 curl -s -H "Content-Type: application/json" -d @- localhost:8000/strato/v2.3/password <<< \"$NEW_PASSWORD\"
echo 
echo "If you see [] above - that's the success. Otherwise repeat the last command in the script"
```

Run it:
```
bash update_password.sh
```
Confirm by typing "ROTATE". The `[]` output with exit code 0 means success.

Remove the script with the passwords in it:
```
rm -rf update-password.sh
```



### Steps to restore the DB dump (for testing or in case of disaster)

1. Stop the vault.
    ```
    sudo docker stop vault-vault-wrapper-1
    ```
2. Terminate connections to oauth.
    ```
    sudo docker exec vault-postgres-1 psql -U postgres -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'oauth' AND pid <> pg_backend_pid();"`
    ```
3. Drop the database.
    ```sudo docker exec vault-postgres-1 psql -U postgres -d postgres -c \
    "DROP DATABASE IF EXISTS oauth;"
   ```
4. Recreate it.
    ```
    sudo docker exec vault-postgres-1 psql -U postgres -d postgres -c \
    "CREATE DATABASE oauth OWNER postgres;"
    ```
5. Restore the dump. Execute from the directory with `vault-dump-file.sql` file:
    ```
    sudo docker exec -i vault-postgres-1 \
    psql -U postgres -d oauth \
    < vault-dump-file.sql
    ```
6. Sanity check.
    ```
    sudo docker exec vault-postgres-1 psql -U postgres -d oauth -c \
    "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM message) AS message;"
    ```
7. Start the vault.
    ```
    sudo docker start vault-vault-wrapper-1
    ```
8. POST the old password.
    ```
    sudo ./enter-password.sh
    # > enter the old password
    ```
9. Verify.
    ```
    sudo docker exec vault-vault-wrapper-1 \
    curl -sf http://localhost:8000/strato/v2.3/verify-password`
    # Expected: true
    ```

---


## Migrating a single key between Vaults

The `migrate-key` tool moves a specific user's key from one Vault instance to another
(different Postgres DB, different vault password) without ever writing the plaintext private
key to disk. It runs in two modes selected by `--out` vs `--in`:

1. `--out=<path>` (**export**): on the **source** vault, decrypt the user's key with the
   source vault password and re-encrypt it under a one-time **transport password**. Writes
   a JSON envelope to `<path>`.
2. `--in=<path>` (**import**): on the **destination** vault, decrypt the envelope with the
   transport password and re-encrypt under the destination vault password. Inserts a new
   user row (or, with `--force`, overwrites an existing one).

Both modes read passwords from **stdin** (two lines, newline-separated). Passwords are never
accepted on the command line or via environment variables, so they do not appear in `ps` or
in shell history.

- Export reads: line 1 = source vault password, line 2 = transport password.
- Import reads: line 1 = transport password, line 2 = destination vault password.

### Postgres connection settings

Postgres connection settings are resolved with the standard CLI > env > default
precedence:

1. **CLI flag** if explicitly passed: `--pghost`, `--pgport`, `--pguser`,
   `--password`, `--database`.
2. **Environment variable** (the same names the vault-wrapper daemon already
   reads from `docker-compose.vault.yml`):
   - `postgres_host`
   - `postgres_port`
   - `postgres_user`
   - `postgres_password`
   - `postgres_vault_wrapper_db`
3. **Default** if neither is set: `postgres` / `5432` / `postgres` / `api` /
   `oauth`.

When running `migrate-key` via `docker exec` inside a `vault-wrapper-*`
container, those env vars are already set by the compose file, so on the
destination vault you usually don't need any `--pghost`/`--pguser`/`--password`/
`--database` flags even if the destination vault uses non-default settings.

### Build and prepare

Build on the source host, install into both vault-wrapper containers (source and destination)
the same way as `change-vault-password` above:
```
cd strato-platform/strato/
stack build blockapps-vault-wrapper-server:exe:migrate-key
stack --local-bin-path ~/.local/bin/ install blockapps-vault-wrapper-server:exe:migrate-key
sudo docker cp ~/.local/bin/migrate-key vault-vault-wrapper-1:/usr/local/bin/migrate-key
sudo docker exec vault-vault-wrapper-1 chmod 755 /usr/local/bin/migrate-key
```
Copy the required dynamically linked libs (secp256k1, libsodium):
```
ldd "$(which migrate-key)" | grep -E 'libsecp256k1|libsodium' | awk '{print $3}' | while read so; do
  real=$(readlink -f "$so")
  echo "copying $real as $(basename $so)"
  sudo docker cp "$real" vault-vault-wrapper-1:/usr/local/lib/$(basename $so)
done
```
Repeat the two `docker cp` steps on the destination host's vault-wrapper container.

### Export the key from the source vault

```
SRC_VAULT_PW=...      # current source-vault password
TRANSPORT_PW=...      # one-time password used only to protect the file in transit

printf '%s\n%s\n' "$SRC_VAULT_PW" "$TRANSPORT_PW" \
  | sudo docker exec -i vault-vault-wrapper-1 /usr/local/bin/migrate-key \
      --x_user_unique_name='alice@example.com' \
      --x_identity_provider_id='https://my-oauth.example.com' \
      --out=/tmp/alice.key.json
# Inside the vault-wrapper container, $postgres_host/$postgres_user/$postgres_password
# /$postgres_vault_wrapper_db are already set by docker-compose.vault.yml, so
# migrate-key picks them up automatically. To override, pass --pghost / --pguser /
# --password / --database / --pgport explicitly.

sudo docker cp vault-vault-wrapper-1:/tmp/alice.key.json ./alice.key.json
sudo docker exec vault-vault-wrapper-1 rm -f /tmp/alice.key.json
```

Move `alice.key.json` to the destination host (e.g. `scp`).

### Import the key into the destination vault

```
TRANSPORT_PW=...      # same one-time password used during export
DST_VAULT_PW=...      # destination-vault password

sudo docker cp ./alice.key.json vault-vault-wrapper-1:/tmp/alice.key.json

printf '%s\n%s\n' "$TRANSPORT_PW" "$DST_VAULT_PW" \
  | sudo docker exec -i vault-vault-wrapper-1 /usr/local/bin/migrate-key --in=/tmp/alice.key.json
# Connection settings come from the container's env vars (postgres_host etc.).
# If the destination vault uses a different host/user/password/db that is NOT
# already in the vault-wrapper container's environment, pass the flags
# explicitly, e.g.:
#     --pghost=my-pg-host --pguser=myuser --password=mypass --database=mydb

sudo docker exec vault-vault-wrapper-1 rm -f /tmp/alice.key.json
rm -f ./alice.key.json
```

If a user with the same `(x_user_unique_name, x_identity_provider_id)` already exists in the
destination DB, the import aborts. Pass `--force` to overwrite the existing row.

### Safety properties

- The plaintext private key only exists in process memory during the run; it is never written
  to disk in either mode.
- The transport file is unreadable without the transport password (NaCl SecretBox / scrypt).
- On both ends the tool verifies that the decrypted private key derives the same Ethereum
  address that was recorded on the source side; any mismatch aborts before any DB write.
- The import runs in a serializable transaction; any failure rolls back with no changes.
- Both vault passwords are validated against the canonical message row before the tool will
  touch the `users` table.
