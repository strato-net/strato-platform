{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric     #-}

module Blockchain.Data.ChainInfo where

import           Data.Aeson

import           Blockchain.Data.RLP
import           Blockchain.ExtWord              (Word256)
import           Blockchain.Strato.Model.Address
import           Blockchain.Data.Enode
import qualified GHC.Generics                              as GHCG
import           Data.Monoid ((<>))

data ChainInfo = ChainInfo {
    chainLabel      :: String,
    addRule         :: String,
    removeRule      :: String,
    members         :: [Enode],
    accountBalance  :: [(Address, Word256)]
} deriving (Eq, Read, Show, GHCG.Generic)

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
    [ rlpEncode $ chainLabel ci
    , rlpEncode $ addRule ci
    , rlpEncode $ removeRule ci
    , RLPArray . map rlpEncode $ members ci
    , RLPArray . map rlpEncode $ accountBalance ci
    ]
  rlpDecode (RLPArray [cl, ar, rr, RLPArray ms, RLPArray ab]) =
    ChainInfo
      (rlpDecode cl)
      (rlpDecode ar)
      (rlpDecode rr)
      (rlpDecode <$> ms)
      (rlpDecode <$> ab)
  rlpDecode o = error $ "rlpDecode ChainInfo: Expected 5 element RLPArray, got " ++ show o
