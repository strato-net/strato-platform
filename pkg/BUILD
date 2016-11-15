#!/bin/bash
set -e

echo "Hello postgrest-packager:BUILD"

exec 2> >(while read line; do echo -e "\e[01;31m$line\e[0m" >&2; done)

#PG_VERSION=9.5 # Sadly, this has to be hard-coded until we can script the build environment
#PG_CONFDIR=$builddir/etc/postgresql/$PG_VERSION/main

#mkdir -p $PG_CONFDIR
#cp {postgresql,pg_hba}.conf $PG_CONFDIR
