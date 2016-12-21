FROM openjdk:8

MAINTAINER Ryan Reich <ryan@blockapps.net>
EXPOSE 1234
VOLUME ["/kafka"]
ENV KAFKA_VERSION="0.9.0.0" SCALA_VERSION="2.11"
ENV KAFKA_HOME /opt/kafka_${SCALA_VERSION}-${KAFKA_VERSION}

RUN \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get update; \
  apt-get install -y unzip wget curl docker jq coreutils net-tools
ADD download-kafka.sh /tmp/download-kafka.sh
WORKDIR /opt
RUN /tmp/download-kafka.sh | tar xz 
ADD start-kafka.sh /usr/bin/start-kafka.sh
ADD broker-list.sh /usr/bin/broker-list.sh
RUN \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get update; \
  apt-get -y install ucspi-tcp netcat-openbsd;
COPY kafka-wrapper.sh /usr/bin

ENTRYPOINT ["/usr/bin/kafka-wrapper.sh"]
