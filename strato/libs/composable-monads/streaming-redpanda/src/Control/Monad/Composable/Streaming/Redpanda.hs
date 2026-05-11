-- | Redpanda streaming backend.
--
-- Redpanda is Kafka API-compatible, so this module re-exports
-- the hw-kafka-client based implementation. Just point StreamAddress
-- at your Redpanda broker instead of Kafka.
--
-- Benefits of Redpanda over Kafka:
--   * No JVM — written in C++, lower memory footprint
--   * Lower latency — optimized for performance
--   * Simpler operations — single binary, no ZooKeeper
--   * Disk-backed — handles backlogs without memory pressure
--
-- Usage: same as Kafka, just change the broker address.

module Control.Monad.Composable.Streaming.Redpanda (
  module Control.Monad.Composable.Streaming.Kafka
) where

import Control.Monad.Composable.Streaming.Kafka
