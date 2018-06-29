{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric     #-}

module Blockchain.Data.ChainInfo where

import           Data.Aeson

import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Data.RLP
import           Blockchain.ExtWord              (Word256)
import           Blockchain.Strato.Model.Address
import           Blockchain.Data.Enode
import qualified GHC.Generics                              as GHCG
import           Data.Monoid ((<>))
import qualified Data.Text                       as T
import           Data.Text.Encoding              (encodeUtf8, decodeUtf8)

import           Test.QuickCheck.Arbitrary

data ChainInfo = ChainInfo {
    chainLabel      :: String,
    addRule         :: String,
    removeRule      :: String,
    members         :: [Enode],
    accountBalance  :: [(Address, Word256)]
} deriving (Eq, Read, Show, GHCG.Generic)

instance Arbitrary ChainInfo where
  arbitrary = ChainInfo
          <$> arbitrary
          <*> arbitrary
          <*> arbitrary
          <*> arbitrary
          <*> arbitrary

instance FromJSON ChainInfo where
  parseJSON (Object o) =
    ChainInfo <$>
    o .: "chainLabel" <*>
    o .: "addRule" <*>
    o .: "removeRule" <*>
    o .: "members" <*>
    o .: "accountBalance"
  parseJSON x = error $ "couldn't parse JSON for chain info: " ++ show x

instance ToJSON ChainInfo where
  toEncoding (ChainInfo cl ar rr ms ab) =
    pairs (
      "chainLabel" .= cl <>
      "addRule" .= ar <>
      "removeRule" .= rr <>
      "members" .= ms <>
      "accountBalance" .= ab
    )

instance RLPSerializable ChainInfo where
  rlpEncode ci = RLPArray
    [ rlpEncode . encodeUtf8 . T.pack $ chainLabel ci
    , rlpEncode . encodeUtf8 . T.pack $ addRule ci
    , rlpEncode . encodeUtf8 . T.pack $ removeRule ci
    , RLPArray . map rlpEncode $ members ci
    , RLPArray . map rlpEncode $ accountBalance ci
    ]
  rlpDecode (RLPArray [cl, ar, rr, RLPArray ms, RLPArray ab]) =
    ChainInfo
      (T.unpack . decodeUtf8 $ rlpDecode cl)
      (T.unpack . decodeUtf8 $ rlpDecode ar)
      (T.unpack . decodeUtf8 $ rlpDecode rr)
      (rlpDecode <$> ms)
      (rlpDecode <$> ab)
  rlpDecode o = error $ "rlpDecode ChainInfo: Expected 5 element RLPArray, got " ++ show o
