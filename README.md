# bloc-haskell

Install `make`, `autoconf`, `libtool`, `blas`, `lapack` and `stack` first.

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
