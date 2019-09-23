{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TupleSections        #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.GenesisInfo (
  GenesisInfo(..),
  defaultGenesisInfo,
  genesisParser,
  ) where

import           GHC.Generics (Generic)
import           Data.Aeson
import           Data.Aeson.Casing (aesonDrop, camelCase)
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Base16             as B16
import qualified Data.JsonStream.Parser             as JS
import           Data.Time
import           Data.Word

import           Blockchain.Data.Address
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.ArbitraryInstances ()
import           Blockchain.Database.MerklePatricia
import           Blockchain.SHA


data GenesisInfo =
  GenesisInfo {
    genesisInfoParentHash       :: SHA,
    genesisInfoUnclesHash       :: SHA,
    genesisInfoCoinbase         :: Address,
    genesisInfoAccountInfo      :: [AccountInfo],
    genesisInfoCodeInfo         :: [CodeInfo],
    genesisInfoTransactionRoot  :: StateRoot, -- Misspelled to match the existing parser
    genesisInfoReceiptsRoot     :: StateRoot,
    genesisInfoLogBloom         :: B.ByteString,
    genesisInfoDifficulty       :: Integer,
    genesisInfoNumber           :: Integer,
    genesisInfoGasLimit         :: Integer,
    genesisInfoGasUsed          :: Integer,
    genesisInfoTimestamp        :: UTCTime,
    genesisInfoExtraData        :: Integer,
    genesisInfoMixHash          :: SHA,
    genesisInfoNonce            :: Word64
} deriving (Show, Read, Eq, Generic)

nullStateRoot :: StateRoot
nullStateRoot = StateRoot . fst . B16.decode $
    "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"

defaultGenesisInfo :: GenesisInfo
defaultGenesisInfo =
  GenesisInfo {
    genesisInfoParentHash = SHA 0,
    genesisInfoUnclesHash = SHA 13478047122767188135818125966132228187941283477090363246179690878162135454535,
    genesisInfoCoinbase = Address 0,
    genesisInfoAccountInfo = [],
    genesisInfoCodeInfo = [],
    genesisInfoTransactionRoot = nullStateRoot,
    genesisInfoReceiptsRoot = nullStateRoot,
    genesisInfoLogBloom = B.replicate 512 0,
    genesisInfoDifficulty = 131072,
    genesisInfoNumber = 0,
    genesisInfoGasLimit = 3141592,
    genesisInfoGasUsed = 0,
    genesisInfoTimestamp = read "1970-01-01 00:00:00 UTC"  ::  UTCTime,
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
    o .:? "codeInfo" .!= [] <*> -- This is manual to account for GenesisInfos missing codeInfo
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
  toJSON = genericToJSON (aesonDrop (B.length "genesisInfo") camelCase)
  toEncoding = genericToEncoding (aesonDrop (B.length "genesisInfo") camelCase)

genesisParser :: JS.Parser GenesisInfo
genesisParser = GenesisInfo
            <$> "parentHash" JS..: JS.value
            <*> "unclesHash" JS..: JS.value
            <*> "coinbase" JS..: JS.value
            <*> accountExtractor
            <*> ("codeInfo" JS..: JS.value JS..| [])
            <*> "transactionRoot" JS..: JS.value
            <*> "receiptsRoot" JS..: JS.value
            <*> "logBloom" JS..: JS.value
            <*> "difficulty" JS..: JS.value
            <*> "number" JS..: JS.value
            <*> "gasLimit" JS..: JS.value
            <*> "gasUsed" JS..: JS.value
            <*> "timestamp" JS..: JS.value
            <*> "extraData" JS..: JS.value
            <*> "mixHash" JS..: JS.value
            <*> "nonce" JS..: JS.value


