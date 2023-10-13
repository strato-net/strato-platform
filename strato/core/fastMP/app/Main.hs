{-# LANGUAGE OverloadedStrings #-}

module Main
  ( main,
  )
where

import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Control.Monad.IO.Class
import Control.Monad.Trans.Resource
import qualified Data.ByteString.Base16 as B16
import Data.ByteString.Char8 (ByteString)
import qualified Data.ByteString.Char8 as BC
import qualified Data.NibbleString as N
import qualified Database.LevelDB as LDB
import FastMP
import KV
import ReverseOrderedKVs
import Text.Format

decodeKV :: [ByteString] -> ([N.Nibble], MP.Val)
decodeKV [k, x] =
  case B16.decode x of
    Right v -> (map c2n $ BC.unpack k, RLPString v)
    _ -> error $ "you are trying to decode a value that is not base16 encoded: " ++ show x
decodeKV x = error $ "input format not correct: " ++ show x

main :: IO ()
main = do
  c <- fmap (map BC.words . BC.lines) $ BC.getContents
  let input = map (uncurry KV . fmap Right . decodeKV) c

  output <-
    runResourceT $ do
      ldb <- LDB.open "abcd2" LDB.defaultOptions {LDB.createIfMissing = True}
      liftIO $ createMPFast ldb $ iPromiseTheseKVsAreOrdered input

  putStrLn $ "final stateroot: " ++ format output
