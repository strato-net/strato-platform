{-# LANGUAGE OverloadedStrings, TupleSections, TypeSynonymInstances, FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.GenesisInfo (
  GenesisInfo(..),
  defaultGenesisInfo
  ) where

import Data.Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.Time
import Data.Word

import Blockchain.Data.Address
--import Blockchain.MiscJSON
import Blockchain.SHA
import Blockchain.Database.MerklePatricia

data GenesisInfo =
  GenesisInfo {
    genesisInfoParentHash::SHA,
    genesisInfoUnclesHash::SHA,
    genesisInfoCoinbase::Address,
    genesisInfoAccountInfo::[(Address, Integer)],
    genesisInfoTransactionsRoot::StateRoot,
    genesisInfoReceiptsRoot::StateRoot,
    genesisInfoLogBloom::B.ByteString,
    genesisInfoDifficulty::Integer,
    genesisInfoNumber::Integer,
    genesisInfoGasLimit::Integer,
    genesisInfoGasUsed::Integer,
    genesisInfoTimestamp::UTCTime,
    genesisInfoExtraData::Integer,
    genesisInfoMixHash::SHA,
    genesisInfoNonce::Word64
} deriving (Show)


defaultGenesisInfo::GenesisInfo
defaultGenesisInfo =
  GenesisInfo { 
    genesisInfoParentHash = SHA 0,
    genesisInfoUnclesHash = SHA 13478047122767188135818125966132228187941283477090363246179690878162135454535,
    genesisInfoCoinbase = Address 0,
    genesisInfoAccountInfo = [],
    genesisInfoTransactionsRoot = StateRoot . fst . B16.decode $ "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    genesisInfoReceiptsRoot = StateRoot . fst . B16.decode $ "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    genesisInfoLogBloom = B.replicate 512 0,
    genesisInfoDifficulty = 131072,
    genesisInfoNumber = 0,
    genesisInfoGasLimit = 3141592,
    genesisInfoGasUsed = 0,
    genesisInfoTimestamp = read "1970-01-01 00:00:00 UTC" :: UTCTime,
    genesisInfoExtraData = 0,
    genesisInfoMixHash = SHA 0, 
    genesisInfoNonce = 42
}

instance FromJSON GenesisInfo where
  parseJSON (Object o) =
    GenesisInfo <$>
    o .: "parentHash" <*>
    o .: "unclesHash" <*>
    o .: "coinbase" <*>
    o .: "accountInfo" <*>
    o .: "transactionRoot" <*>
    o .: "receiptsRoot" <*>
    o .: "logBloom" <*>
    o .: "difficulty" <*>
    o .: "number" <*>
    o .: "gasLimit" <*>
    o .: "gasUsed" <*>
    o .: "timestamp" <*>
    o .: "extraData" <*>
    o .: "mixHash" <*>
    o .: "nonce"
  parseJSON x = error $ "couldn't parse JSON for genesis block: " ++ show x
  
instance ToJSON GenesisInfo where
  toJSON x =
    object [
      "parentHash" .= genesisInfoParentHash x,
      "unclesHash" .= genesisInfoUnclesHash x,
      "coinbase" .= genesisInfoCoinbase x,
      "accountInfo" .= genesisInfoAccountInfo x,
      "transactionRoot" .= genesisInfoTransactionsRoot x,
      "receiptsRoot" .= genesisInfoReceiptsRoot x,
      "logBloom" .= genesisInfoLogBloom x,
      "difficulty" .= genesisInfoDifficulty x,
      "number" .= genesisInfoNumber x,
      "gasLimit" .= genesisInfoGasLimit x,
      "gasUsed" .= genesisInfoGasUsed x,
      "timestamp" .= genesisInfoTimestamp x,
      "extraData" .= genesisInfoExtraData x,
      "mixHash" .= genesisInfoMixHash x,
      "nonce" .= genesisInfoNonce x
      ]
