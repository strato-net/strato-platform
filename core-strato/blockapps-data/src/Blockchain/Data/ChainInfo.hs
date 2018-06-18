{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric     #-}

module Blockchain.Data.ChainInfo where

import           Data.Aeson
import qualified Data.Text                       as T

import           Blockchain.ExtWord              (Word256)
import           Blockchain.Strato.Model.Address
import qualified GHC.Generics                              as GHCG

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


