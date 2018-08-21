{-# LANGUAGE TemplateHaskell #-}
module Main where

import Blockchain.Strato.Model.Address
import qualified Data.ByteString.Base64 as B64
import Control.Monad
import Network.Haskoin.Crypto hiding (Address)
import System.Entropy
import HFlags

defineFlag "c:count" (1 :: Int) "Number of keys to generate"
$(return [])

main :: IO ()
main = do
  void $ $initHFlags "keygen"
  pks <- withSource getEntropy . replicateM flags_count $ genPrvKey
  print ("NODEKEY", "--validator")
  forM_ pks $ \pk ->
    print (B64.encode . encodePrvKey $ pk, formatAddress . prvKey2Address $ pk)
  print "All validators:"
  print . map (formatAddress . prvKey2Address) $ pks
