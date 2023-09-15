{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Strato.Lite.Init
  ( runStratoLite
  ) where

import qualified Control.Monad.Change.Modify       as Mod
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.ChainMember
import           Data.IORef
import           Data.Text                (Text)
import           Strato.Lite.Options
import           Strato.Lite.Rest
import           Strato.Lite.Monad
import           Network.Wai.Handler.Warp
import qualified Network.Kafka                     as K

runStratoLite :: ( Mod.Modifiable K.KafkaState (ReaderT (IORef P2PContext) (ReaderT P2PPeer (ResourceT (Control.Monad.Logger.LoggingT IO))))
                 )
              => [(Text, ChainMemberParsedSet, Text)] -> IO ()
runStratoLite nodes' = do
  let nodes'' = (\(a,b,c) -> (a, (b, IPAsText c, TCPPort 30303, UDPPort 30303))) <$> nodes'
  mgr <- runNetwork nodes'' id
  run flags_port $ stratoLiteRestApp mgr
