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
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Host
import qualified Data.Cache as Cache
import qualified Data.Map.Strict as M
import Data.Text (Text)
import Network.Wai.Handler.Warp
import Strato.Lite.Monad
import Strato.Lite.Options
import Strato.Lite.Rest
import System.Clock

runStratoLite :: [(Text, Text, Text)] -> IO ()
runStratoLite nodes' = do
  let nodes'' = (\(a, b, c) -> (a, (b, Host c, TCPPort 30303, UDPPort 30303))) <$> nodes'
  mgr <- runNetwork nodes'' id

  let stateFetchLimit' = 100
      nonceCounterTimeout = 10

  nonceCache <- Cache.newCache . Just $ TimeSpec nonceCounterTimeout 0

  let env =
        BlocEnv
          { txSizeLimit = 150000,
            accountNonceLimit = 1000000,
            gasLimit = 10000000,
            stateFetchLimit = stateFetchLimit',
            globalNonceCounter = nonceCache,
            userRegistryAddress = Address 0x100,
            userRegistryCodeHash = Nothing,
            useWalletsByDefault = False
          }

  run flags_port $ stratoLiteRestApp mgr env M.empty
