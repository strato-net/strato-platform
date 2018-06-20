{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric     #-}

module Blockchain.Data.ChainInfo where

import           Data.Aeson
import qualified Data.Text                       as T

import           Blockchain.ExtWord              (Word256)
import           Blockchain.Strato.Model.Address
import qualified GHC.Generics                              as GHCG
import           Data.Monoid ((<>))

data ChainInfo = ChainInfo {
    chainLabel      :: String,
    addRule         :: String,
    removeRule      :: String,
    members         :: [String],
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
  toEncoding (ChainInfo chainLabel addRule removeRule members accountBalance) = 
    pairs (
      "chainLabel" .= chainLabel <>
      "addRule" .= addRule <>
      "removeRule" .= removeRule <>
      "members" .= members <>
      "accountBalance" .= accountBalance
    )
