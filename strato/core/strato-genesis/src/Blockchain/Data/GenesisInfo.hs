{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.GenesisInfo
  ( GenesisInfo (..),
    defaultGenesisInfo,
    genesisParser,
    getGenesisInfoFromFile,
  )
where

import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.ChainInfo
import Blockchain.Database.MerklePatricia
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Keccak256
import Control.Lens
import Control.Monad.IO.Class
import Data.Aeson
import Data.Aeson.Casing (aesonDrop, camelCase)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.JsonStream.Parser as JS
import Data.Time
import Data.Word
import GHC.Generics (Generic)
import qualified LabeledError

data GenesisInfo = GenesisInfo
  { genesisInfoParentHash :: Keccak256,
    genesisInfoUnclesHash :: Keccak256,
    genesisInfoCoinbase :: ChainMemberParsedSet,
    genesisInfoAccountInfo :: [AccountInfo],
    genesisInfoCodeInfo :: [CodeInfo],
    genesisInfoTransactionRoot :: StateRoot, -- Misspelled to match the existing parser
    genesisInfoReceiptsRoot :: StateRoot,
    genesisInfoLogBloom :: B.ByteString,
    genesisInfoDifficulty :: Integer,
    genesisInfoNumber :: Integer,
    genesisInfoGasLimit :: Integer,
    genesisInfoGasUsed :: Integer,
    genesisInfoTimestamp :: UTCTime,
    genesisInfoExtraData :: Integer,
    genesisInfoMixHash :: Keccak256,
    genesisInfoNonce :: Word64
  }
  deriving (Show, Read, Eq, Generic)

makeLenses ''GenesisInfo

nullStateRoot :: StateRoot
nullStateRoot =
  StateRoot . LabeledError.b16Decode "nullStateRoot" $
    "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"

defaultGenesisInfo :: GenesisInfo
defaultGenesisInfo =
  GenesisInfo
    { genesisInfoParentHash = unsafeCreateKeccak256FromWord256 0,
      genesisInfoUnclesHash = unsafeCreateKeccak256FromWord256 13478047122767188135818125966132228187941283477090363246179690878162135454535,
      genesisInfoCoinbase = emptyChainMember,
      genesisInfoAccountInfo = [],
      genesisInfoCodeInfo = [],
      genesisInfoTransactionRoot = nullStateRoot,
      genesisInfoReceiptsRoot = nullStateRoot,
      genesisInfoLogBloom = B.replicate 512 0,
      genesisInfoDifficulty = 131072,
      genesisInfoNumber = 0,
      genesisInfoGasLimit = 3141592,
      genesisInfoGasUsed = 0,
      genesisInfoTimestamp = read "1970-01-01 00:00:00 UTC" :: UTCTime,
      genesisInfoExtraData = 0,
      genesisInfoMixHash = unsafeCreateKeccak256FromWord256 0,
      genesisInfoNonce = 42
    }

instance FromJSON GenesisInfo where
  parseJSON (Object o) =
    GenesisInfo
      <$> o .: "parentHash"
      <*> o .: "unclesHash"
      <*> o .: "coinbase"
      <*> o .: "accountInfo"
      <*> o .:? "codeInfo" .!= []
      <*> o .: "transactionRoot" -- This is manual to account for GenesisInfos missing codeInfo
      <*> o .: "receiptsRoot"
      <*> o .: "logBloom"
      <*> o .: "difficulty"
      <*> o .: "number"
      <*> o .: "gasLimit"
      <*> o .: "gasUsed"
      <*> o .: "timestamp"
      <*> o .: "extraData"
      <*> o .: "mixHash"
      <*> o .: "nonce"
  parseJSON x = error $ "couldn't parse JSON for genesis block: " ++ show x

instance ToJSON GenesisInfo where
  toJSON = genericToJSON (aesonDrop (B.length "genesisInfo") camelCase)
  toEncoding = genericToEncoding (aesonDrop (B.length "genesisInfo") camelCase)

genesisParser :: JS.Parser GenesisInfo
genesisParser =
  GenesisInfo
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

getGenesisInfoFromFile :: MonadIO m => String -> m GenesisInfo
getGenesisInfoFromFile genesisBlockName = do
  theJSONString <- liftIO . BLC.readFile $ genesisBlockName ++ "Genesis.json"
  let genesis = JS.parseLazyByteString genesisParser theJSONString
  case genesis of
    [x] -> pure x
    _ -> error $ "invalid genesis: " ++ show genesis
