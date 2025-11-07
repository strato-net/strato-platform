{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Lite.Init
  ( runStratoLite,
  )
where

import Bloc.Monad
import BlockApps.Logging
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Secp256k1
import Control.Monad.IO.Class
import Control.Monad.Trans.Resource
import qualified Data.Cache as Cache
import qualified Data.Map.Strict as M
import Data.Text (Text)
import Network.Wai.Handler.Warp
import Strato.Lite.Simulator
import Strato.Lite.Options
import Strato.Lite.Rest
import System.Clock

runStratoLite :: [(Text, Text, Text)] -> IO ()
runStratoLite nodes' = do
  privKeys <- liftIO $ traverse (const newPrivateKey) nodes'
  let nodes'' = (\(p, (a, _, c)) -> (a, (p, Host c, TCPPort 30303, UDPPort 30303))) <$> zip privKeys nodes'
  mgr <- runLoggingT . runResourceT $ runNetwork nodes'' id

  let stateFetchLimit' = 100
      nonceCounterTimeout = 10

  nonceCache <- Cache.newCache . Just $ TimeSpec nonceCounterTimeout 0

  let env =
        BlocEnv
          { txSizeLimit = 150000,
            gasLimit = 10000000,
            stateFetchLimit = stateFetchLimit',
            globalNonceCounter = nonceCache,
            nodePubKey = derivePublicKey $ privKeys !! 0
          }

  run flags_port $ stratoLiteSimulatorRestApp mgr env M.empty
