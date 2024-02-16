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

import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.ChainMember
import Data.Text (Text)
import Network.Wai.Handler.Warp
import Strato.Lite.Monad
import Strato.Lite.Options
import Strato.Lite.Rest

runStratoLite :: [(Text, ChainMemberParsedSet, Text)] -> IO ()
runStratoLite nodes' = do
  let nodes'' = (\(a, b, c) -> (a, (b, IPAsText c, TCPPort 30303, UDPPort 30303))) <$> nodes'
  mgr <- runNetwork nodes'' id
  run flags_port $ stratoLiteRestApp mgr
