# bootstrap-docker

Helper scripts for the services the CI pipelines start next to a test node:

- `vault`: a STRATO Vault from `docker-compose.vault.yml`
- `highway`: a file server from `docker-compose.highway.yml`
- `ssl/`: the certificate and key the two are started with (replace the dummy ones)

To run a STRATO node from a release without building, see [Run from prebuilt images](../techdocs/node/prebuilt.md).
