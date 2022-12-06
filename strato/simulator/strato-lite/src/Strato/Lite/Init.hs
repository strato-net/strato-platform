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

import           Blockchain.Strato.Discovery.Data.Peer
import           Data.Text                (Text)
import           Strato.Lite.Options
import           Strato.Lite.Rest
import           Strato.Lite.Monad
import           Network.Wai.Handler.Warp

runStratoLite :: [(Text, Text)] -> IO ()
runStratoLite nodes' = do
  let nodes'' = (\(a,b) -> (a, (IPAsText b, TCPPort 30303, UDPPort 30303))) <$> nodes'
  mgr <- runNetwork nodes'' id
  run flags_port $ stratoLiteRestApp mgr