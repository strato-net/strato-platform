{-# LANGUAGE OverloadedStrings #-}

module Main (
  main
  ) where

import Control.Monad.Trans.Resource
--import Crypto.Hash.Keccak
import qualified Data.ByteString.Base16 as B16
import Data.ByteString.Char8 (ByteString)
import qualified Data.ByteString.Char8 as BC
import Data.Conduit
--import Data.List

import Blockchain.Data.RLP

import KV
import LevelDBTools

import FastMP

decodeVal :: ByteString -> ByteString
decodeVal x =
  case B16.decode x of
    (v, "") -> v
    _ -> error $ "you are trying to decode a value that is not base16 encoded: " ++ show x

main :: IO ()
main = do
  c <- fmap (map BC.words . BC.lines) $ BC.getContents
  let input = map (\[x, y] -> KV x $ Right (RLPString . rlpSerialize . RLPString . decodeVal $ y)) c
--  let input = map (\[x, y] -> KV x $ Right (RLPString . fst . B16.decode $ y)) c

--  doit (input, []) $$ kvToStdout
  runResourceT $ runConduit $ doit (input, []) .| outputToLDB



