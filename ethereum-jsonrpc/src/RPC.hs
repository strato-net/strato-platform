{-# LANGUAGE OverloadedStrings #-}

module RPC (
  doRPC
  ) where

import Network.JsonRpc.Server
import qualified Data.ByteString.Lazy.Char8 as B

import Data.Maybe

import Commands

doRPC::B.ByteString->IO B.ByteString
doRPC request = do
  fmap fromJust $ call methods request
