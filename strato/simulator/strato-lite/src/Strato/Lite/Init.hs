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

import qualified Data.Text                as T
import           Data.Text                (Text)
import           Strato.Lite.Options
import           Strato.Lite.Rest
import           Strato.Lite.Monad
import           Network.Wai.Handler.Warp

runStratoLite :: [(Text, Text)] -> [(Text, Text)] -> IO ()
runStratoLite nodes' connections' = do
  eMgr <- runNetwork nodes' connections' id
  case eMgr of
    Left e -> error $ T.unpack e
    Right mgr -> run flags_port $ stratoLiteRestApp mgr