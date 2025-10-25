{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.GenesisInfo
  ( GenesisInfo (..),
    defaultGenesisInfo,
    getGenesisInfo,
    module Blockchain.Data.AddressInfo,
    module Blockchain.Data.CodeInfo
  )
where

import Blockchain.Data.AddressInfo
import Blockchain.Data.CodeInfo
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.Address
import Blockchain.Database.MerklePatricia
import Blockchain.Strato.Model.Keccak256
import Blockchain.Stream.Action (Delegatecall)
import Control.Monad.IO.Class
import Data.Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.JsonStream.Parser as JS
import Data.Time
import Data.Word
import GHC.Generics (Generic)
import qualified LabeledError
import Text.Format
import Text.Tools
import qualified Data.Map.Strict as M
import qualified Data.Sequence as S

data GenesisInfo = GenesisInfo
  { parentHash :: Keccak256,
    unclesHash :: Keccak256,
    addressInfo :: [AddressInfo],
    codeInfo :: [CodeInfo],
    transactionRoot :: StateRoot, -- Misspelled to match the existing parser
    receiptsRoot :: StateRoot,
    logBloom :: B.ByteString,
    difficulty :: Integer,
    number :: Integer,
    gasLimit :: Integer,
    gasUsed :: Integer,
    timestamp :: UTCTime,
    extraData :: Integer,
    mixHash :: Keccak256,
    nonce :: Word64,
    events :: M.Map Address (S.Seq Event),
    delegatecalls :: M.Map Address (S.Seq Delegatecall)
  }
  deriving (Show, Read, Eq, Generic)

instance Format GenesisInfo where
  format GenesisInfo{..} =
    "GenesisInfo\n" ++ tab (
    "parentHash: " ++ format parentHash ++ "\n"
    ++ "unclesHash: " ++ format unclesHash ++ "\n"
    ++ "addressInfo:\n"
    ++  tab (unlines $ map format addressInfo) ++ "\n"
    ++ "codeInfo:\n"
    ++  tab (unlines $ map format codeInfo) ++ "\n"
    ++ "transactionRoot: " ++ format transactionRoot ++ "\n"
    ++ "receiptsRoot: " ++ format receiptsRoot ++ "\n"
    ++ "logBloom: " ++ format logBloom ++ "\n"
    ++ "difficulty: " ++ show difficulty ++ "\n"
    ++ "number: " ++ show number ++ "\n"
    ++ "gasLimit: " ++ show gasLimit ++ "\n"
    ++ "gasUsed: " ++ show gasUsed ++ "\n"
    ++ "timestamp: " ++ show timestamp ++ "\n"
    ++ "extraData: " ++ show extraData ++ "\n"
    ++ "mixHash: " ++ format mixHash ++ "\n"
    ++ "nonce: " ++ show nonce
    )

nullStateRoot :: StateRoot
nullStateRoot =
  StateRoot . LabeledError.b16Decode "nullStateRoot" $
    "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"

defaultGenesisInfo :: GenesisInfo
defaultGenesisInfo =
  GenesisInfo
    { parentHash = unsafeCreateKeccak256FromWord256 0,
      unclesHash = unsafeCreateKeccak256FromWord256 13478047122767188135818125966132228187941283477090363246179690878162135454535,
      addressInfo = [],
      codeInfo = [],
      transactionRoot = nullStateRoot,
      receiptsRoot = nullStateRoot,
      logBloom = B.replicate 512 0,
      difficulty = 131072,
      number = 0,
      gasLimit = 31415920000000000000000000,
      gasUsed = 0,
      timestamp = read "1970-01-01 00:00:00 UTC" :: UTCTime,
      extraData = 0,
      mixHash = unsafeCreateKeccak256FromWord256 0,
      nonce = 42,
      events = M.empty,
      delegatecalls = M.empty
    }

instance FromJSON GenesisInfo where

instance ToJSON GenesisInfo where

getGenesisInfo :: MonadIO m => m GenesisInfo
getGenesisInfo = do
  theJSONString <- liftIO $ BLC.readFile "genesis.json"
  case JS.eitherDecode theJSONString of
    Left e -> error $ "Failed to parse genesis.json: " ++ show e
    Right genesisInfo -> return genesisInfo
