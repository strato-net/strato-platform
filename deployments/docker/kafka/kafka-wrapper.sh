#!/bin/bash

kafkaTopics="
kafkaOut=\$($KAFKA_HOME/bin/kafka-topics.sh \$args 2>&1);
kafkaExit=\$?;
echo \$kafkaExit \$kafkaOut;
"

tcpserver 0 1124 bash -c "read args; $kafkaTopics" &
disown %

until nc -z ${KAFKA_ZOOKEEPER_CONNECT/:/ } >&/dev/null
do echo "Waiting for Zookeeper to start"
   sleep 1
done

echo "Waiting for Zookeeper to purge expired sessions"
sleep 8

exec start-kafka.sh
