# bloc-haskell

### The info may be obsolete: see the strato-platform readme for the up-to-date requirements

Install `make`, `autoconf`, `libtool`, `blas`, `lapack` and `stack` first.

```
sudo apt-get install autoconf libtool libblas-dev liblapack-dev libsodium-dev postgresql-9.6 postgresql-server-dev-9.6 libsecp256k1-dev
```

## testing

`stack test`

## Run bloch server with docker-compose up
```sh
pghost=postgres \
pguser=postgres \
pgpasswd=api \
stratourl=http://localhost \
docker-compose up -d
```
