{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Executable.EthereumDiscovery (
  ethereumDiscovery
  ) where

import qualified Data.Text                               as T

import           BlockApps.Logging
import           Blockchain.Strato.Discovery.ContextLite
import           Blockchain.Strato.Discovery.UDPServer

import qualified Text.Colors                             as CL

ethereumDiscovery :: MonadDiscovery m => DiscoveryRunner m (LoggingT IO) () -> LoggingT IO ()
ethereumDiscovery runner = do
  $logInfoS "ethereumDiscovery" $ T.pack $ CL.blue "Welcome to ethereum-discovery"
  $logInfoS "ethereumDiscovery" $ T.pack $ CL.blue "============================="
  runner runEthUDPServer

