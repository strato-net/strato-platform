{-# LANGUAGE OverloadedStrings #-}

module RPC
  ( doRPC,
  )
where

import Commands
import qualified Data.ByteString.Lazy.Char8 as B
import Data.Maybe
import Network.JsonRpc.Server

doRPC :: B.ByteString -> IO B.ByteString
doRPC request = do
  fmap fromJust $ call methods request
