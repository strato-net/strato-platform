{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
module Main where

import Blockchain.Strato.Model.Address
import Data.Aeson
import Data.Aeson.Encode.Pretty
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy.Char8 as CL8
import qualified Data.ByteString.Base64 as B64
import Data.List (sort)
import Control.Monad
import Network.Haskoin.Crypto hiding (Address)
import System.Entropy
import HFlags

defineFlag "c:count" (1 :: Int) "Number of keys to generate"
$(return [])

data KeyPair = KeyPair PrvKey

instance ToJSON KeyPair where
  toJSON (KeyPair prvkey) = object [ "private_key" .= pkString, "address" .= prvKey2Address prvkey]
      where pkString = C8.unpack . B64.encode . encodePrvKey $ prvkey

data KeyList = KeyList [KeyPair] [Address]

instance ToJSON KeyList where
  toJSON (KeyList ps as) = object [ "key_address_pairs" .= ps, "all_validators" .= as]

main :: IO ()
main = do
  void $ $initHFlags "keygen"
  pks <- withSource getEntropy . replicateM flags_count $ genPrvKey
  let ps = map KeyPair pks
      as = sort . map prvKey2Address $ pks
  CL8.putStrLn . encodePretty $ KeyList ps as
