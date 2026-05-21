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

You may want to migrate the existing keys from BlockApps shared Vault to you local vault.
> TODO: Steps are TBD.

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
```
cd strato-platform/strato/
# here install dependencies if needed, using ../install_deps.sh
stack build blockapps-vault-wrapper-server:exe:change-vault-password
stack --local-bin-path ~/.local/bin/ install  blockapps-vault-wrapper-server:exe:change-vault-password
sudo docker cp /home/ec2-user/.local/bin/change-vault-password vault-vault-wrapper-1:/usr/local/bin/change-vault-password
sudo docker exec vault-vault-wrapper-1 chmod 755 /usr/local/bin/change-vault-password
```

Copy the required dynamically linked libs (secp256k1, libsodium) into docker container:
```
ldd "$(which change-vault-password)" | grep -E 'libsecp256k1|libsodium' | awk '{print $3}' | while read so; do
  # resolve symlinks to get the real file
  real=$(readlink -f "$so")
  echo "copying $real as $(basename $so)"
  sudo docker cp "$real" vault-vault-wrapper-1:/usr/local/lib/$(basename $so)
done
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
cd strato-getting-started


# sudo PASSWORD="${NEW_PASSWORD}" ./vault --set-password
sudo docker exec -i vault-vault-wrapper-1 curl -s -H "Content-Type: application/json" -d @- localhost:8000/strato/v2.3/password <<< \"$NEW_PASSWORD\"
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
