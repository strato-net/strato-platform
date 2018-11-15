{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Executable.EthereumDiscovery (
  ethereumDiscovery
  ) where

import           UnliftIO.Exception
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.Trans.Resource
import qualified Data.ByteString                         as B
import qualified Data.ByteString.Base16                  as B16
import           Data.Maybe
import qualified Data.Text                               as T
import qualified Network.Haskoin.Internals               as H
import qualified Network.Socket                          as S

import qualified Blockchain.Colors                       as CL
import           Blockchain.Data.PubKey
import           Blockchain.EthConf

import           Blockchain.Strato.Discovery.ContextLite
import           Blockchain.Strato.Discovery.P2PUtil
import           Blockchain.Strato.Discovery.UDPServer

privateKey :: H.PrvKey
privateKey = fromMaybe (error "Bad value for hardcoded private key in ethconf.yaml") $ H.makePrvKey $ unPrivKey $ privKey ethConf

ethereumDiscovery :: LoggingT IO ()
ethereumDiscovery = do
  let Right pubKey = hPubKeyToPubKey $ H.derivePubKey privateKey
  _ <- $logInfoS "ethereumDiscovery" $ T.pack $ CL.blue "Welcome to ethereum-discovery"
  _ <- $logInfoS "ethereumDiscovery" $ T.pack $ CL.blue "============================="
  _ <- $logInfoS "ethereumDiscovery" $ T.pack $ CL.green " * My NodeID is " ++ show (B16.encode $ B.pack $ pointToBytes pubKey)
  _ <- runResourceT $ do
    cxt <- initContextLite

    bracket
      (connectMe $ discoveryPort $ discoveryConfig ethConf)
      (liftIO . S.close)
      (runEthUDPServer cxt privateKey (discoveryPort $ discoveryConfig ethConf))

  return ()
