
module Network.Kafka.Tools where

import Network.Kafka.Protocol

_kMetadata::Metadata->KafkaString
_kMetadata (Metadata x) = x
