{-# LANGUAGE OverloadedStrings #-}

module Main (
  main
  ) where

import qualified Data.ByteString.Base16 as B16
import Data.ByteString.Char8 (ByteString)
import qualified Data.ByteString.Char8 as BC

import Blockchain.Data.RLP
import KV
import FastMP
import ReverseOrderedKVs
import Text.Format

decodeVal :: ByteString -> ByteString
decodeVal x =
  case B16.decode x of
    (v, "") -> v
    _ -> error $ "you are trying to decode a value that is not base16 encoded: " ++ show x

main :: IO ()
main = do
  c <- fmap (map BC.words . BC.lines) $ BC.getContents
  let input = map (\[x, y] -> KV x $ Right (RLPString . decodeVal $ y)) c

  output <- createMPFast $ iPromiseTheseKVsAreOrdered input

  putStrLn $ "final stateroot: " ++ format output



