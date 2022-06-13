{-# LANGUAGE OverloadedStrings #-}

module RPC (
  doRPC
  ) where

import qualified Data.ByteString.Lazy.Char8 as B
import           Network.JsonRpc.Server

import           Data.Maybe

import           Commands

doRPC::B.ByteString->IO B.ByteString
doRPC request = do
  fmap fromJust $ call methods request
