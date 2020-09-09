{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Executable.EthereumDiscovery (
  ethereumDiscovery
  ) where

import           Control.Monad.IO.Class
import           Blockchain.Output
import           Control.Monad.Trans.Resource
import qualified Data.Text                               as T
import qualified Network.Socket                          as S
import           UnliftIO.Exception

import           Blockchain.EthConf
import           Blockchain.Strato.Discovery.ContextLite
import           Blockchain.Strato.Discovery.UDPServer
import           Executable.Options

import qualified Text.Colors                             as CL

ethereumDiscovery :: LoggingT IO ()
ethereumDiscovery = do
  _ <- $logInfoS "ethereumDiscovery" $ T.pack $ CL.blue "Welcome to ethereum-discovery"
  _ <- $logInfoS "ethereumDiscovery" $ T.pack $ CL.blue "============================="
  _ <- $logInfoS "ethereumDiscovery" $ T.pack $ CL.green $ "Talking to vault-wrapper at " ++ flags_vaultWrapperUrl
  _ <- runResourceT $ do
    cxt <- initContextLite flags_vaultWrapperUrl

    bracket
      (connectMe $ discoveryPort $ discoveryConfig ethConf)
      (liftIO . S.close)
      (runEthUDPServer cxt (discoveryPort $ discoveryConfig ethConf))

  return ()
