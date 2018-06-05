#!/bin/bash

set -e
set -x

stratoRoot=http://${stratoHost}/eth/v1.2
cirrusRoot=http://${cirrusHost}

echo "Environment variables:
slipstream:
<<<<<<< 5a0e9ef6fe7ec52c47d851b8a5693462e679754a
<<<<<<< 483e77a7f0dcefeecb2284cebc0a59e3ea56a6f1
=======
>>>>>>> slipstream with postgrest on
--pghost=\$postgres_host="${postgres_host}"
--pgport=\$postgres_port="${postgres_port}"
--pguser=\$postgres_user="${postgres_user}"
--password=\$postgres_password="${postgres_password}"
--database=\$postgres_slipstream_db="${postgres_slipstream_db}"
<<<<<<< ace13098df5d7782d6f03348411e9e3b6b40a0fb
<<<<<<< 5a0e9ef6fe7ec52c47d851b8a5693462e679754a
=======
--pghost=postgres_host=${postgres_host}
--pgport=postgres_port=${postgres_port}
--pguser=postgres_user=${postgres_user}
--password=postgres_password=${postgres_password}
--database=postgres_slipstream_db=${postgres_slipstream_db}
>>>>>>> slipstream added to bloc container; cirrus off (step 1); tests temporary off
=======
>>>>>>> slipstream with postgrest on
=======
--stratourl\$stratoRoot="${stratoRoot}"
--kafkahost=\$kafka_host="${kafkahost}"
--kafkaport=\$kafka_port="${kafkaport}"
<<<<<<< 3f730be9ec2443c949c35334466f0c604b431554
--topicname=\$kafka_topic="${topicname}"
>>>>>>> Modified Config
=======
>>>>>>> Removed Topic Name Suffixes

strato-server:
no vars/flags set

bloc:
<<<<<<< 5a0e9ef6fe7ec52c47d851b8a5693462e679754a
<<<<<<< 483e77a7f0dcefeecb2284cebc0a59e3ea56a6f1
=======
>>>>>>> slipstream with postgrest on
stratoHost="${stratoHost}"
--cirrusurl=\$cirrusHost="${cirrusHost}"
--stratourl=\$stratoRoot="${stratoRoot}"
--pghost=\$postgres_host="${postgres_host}"
--pgport=\$postgres_port="${postgres_port}"
--pguser=\$postgres_user="${postgres_user}"
--password=\$postgres_password="${postgres_password}"
--loglevel=\$loglevel="${loglevel:-4}"
<<<<<<< 5a0e9ef6fe7ec52c47d851b8a5693462e679754a
=======
stratoHost=${stratoHost}
--cirrusurl=cirrusHost=${cirrusHost}
--stratourl=stratoRoot=${stratoRoot}
--pghost=postgres_host=${postgres_host}
--pgport=postgres_port=${postgres_port}
--pguser=postgres_user=${postgres_user}
--password=postgres_password=${postgres_password}
--loglevel=loglevel=${loglevel:-4}
>>>>>>> slipstream added to bloc container; cirrus off (step 1); tests temporary off
=======
>>>>>>> slipstream with postgrest on
"

locale-gen "en_US.UTF-8"
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

echo "Waiting for STRATO to be available..."
until curl ${stratoRoot} >& /dev/null; do
    sleep 0.5
done
echo "STRATO is available"

echo 'Waiting for postgres to be available...'
while true; do
    curl ${postgres_host}:${postgres_port} > /dev/null 2>&1 || EXIT_CODE=$? && true
    if [ ${EXIT_CODE} = 52 ]; then
        break
    fi
    sleep 0.5
done

mkdir logs
<<<<<<< 483e77a7f0dcefeecb2284cebc0a59e3ea56a6f1

# TODO: refactor bloc (and monstrato) dockerization using supervisord for more process control, log aggregation and health monitoring

/usr/bin/blockapps-strato-server >> logs/strato-server 2>&1 &

# TODO: add kafka/zk connection flags to run slipstream (when slipstream supports them) and may be others (strato? bloc?..)
/usr/bin/slipstream --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
<<<<<<< 3f730be9ec2443c949c35334466f0c604b431554
<<<<<<< 0366ad58ccf58dde76d447c4d62f57dc30e11016
<<<<<<< 134aebe64f1f11f164cf8f819921c6758fbedad0
<<<<<<< 5a0e9ef6fe7ec52c47d851b8a5693462e679754a
            --database="$postgres_slipstream_db"  --topicname="$topic_name" >> logs/slipstream 2>&1 &
=======
            --database="$postgres_slipstream_db"  --topicname="$topicname" \
<<<<<<< ace13098df5d7782d6f03348411e9e3b6b40a0fb
            --stratourl="$stratoHost" --kafkahost="$kafkahost" --kafkaport="$kafkaport" >> logs/slipstream 2>&1 &
>>>>>>> Added HFlags

/usr/bin/blockapps-bloc --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
            --stratourl="$stratoRoot" --loglevel="${loglevel:-4}" --cirrusurl="$cirrusRoot" +RTS -N1 2>&1
=======

# TODO: refactor bloc (and monstrato) dockerization using supervisord for more process control, log aggregation and health monitoring
>>>>>>> slipstream added to bloc container; cirrus off (step 1); tests temporary off

/usr/bin/blockapps-strato-server >> logs/strato-server 2>&1 &

# TODO: add kafka/zk connection flags to run slipstream (when slipstream supports them) and may be others (strato? bloc?..)
/usr/bin/slipstream --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
            --database="$postgres_db" >> logs/slipstream 2>&1 &
=======
            --database="$postgres_slipstream_db" >> logs/slipstream 2>&1 &
>>>>>>> slipstream with postgrest on
=======
            --database="$postgres_slipstream_db"  --topicname="$topic_name" >> logs/slipstream 2>&1 &
>>>>>>> Fixed getMessages
=======
            --stratourl="$stratourl" --kafkahost="$kafkahost" --kafkaport="$kafkaport" >> logs/slipstream 2>&1 &
>>>>>>> Modified Config
=======
            --database="$postgres_slipstream_db"  --stratourl="$stratourl" \
            --kafkahost="$kafkahost" --kafkaport="$kafkaport" >> logs/slipstream 2>&1 &
>>>>>>> Removed Topic Name Suffixes

/usr/bin/blockapps-bloc --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
            --stratourl="$stratoRoot" --loglevel="${loglevel:-4}" --cirrusurl="$cirrusRoot" +RTS -N1 2>&1
