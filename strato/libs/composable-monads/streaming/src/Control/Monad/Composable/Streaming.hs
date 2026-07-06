-- | Umbrella module for message streaming.
--
-- This module re-exports the active streaming client library.
-- To switch, change the backend dependency in package.yaml.
module Control.Monad.Composable.Streaming (
  module Control.Monad.Composable.Streaming.Backend
) where

import Control.Monad.Composable.Streaming.Backend
