#!/bin/bash

pghost=${pghost:-localhost}

echo "pghost = $pghost"

until netcat -z $pghost 5432 >&/dev/null
do echo "Waiting for postgres to start"
   sleep 1
done

until /usr/bin/global-db --pghost $pghost
do  echo >&2 "Database not actually started.  Retrying..."
    sleep 1
done
