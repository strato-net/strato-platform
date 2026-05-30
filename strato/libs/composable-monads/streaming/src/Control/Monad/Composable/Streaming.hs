-- | Umbrella module for message streaming.
--
-- This module re-exports the active streaming client library.
-- To switch, change this import, DockerConfig.hs, and package.yaml.
module Control.Monad.Composable.Streaming (
  module Control.Monad.Composable.Streaming.Kafka
) where

import Control.Monad.Composable.Streaming.Kafka
