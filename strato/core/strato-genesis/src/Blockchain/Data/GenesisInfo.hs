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
import Blockchain.Strato.Model.Validator (Validator)
import Blockchain.Stream.Action (Delegatecall)
import Control.Monad.IO.Class
import Data.Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy.Char8 as BLC
import Data.Default
import qualified Data.JsonStream.Parser as JS
import Data.Time
import GHC.Generics (Generic)
import qualified LabeledError
import Text.Format
import Text.Tools
import qualified Data.Map.Strict as M
import qualified Data.Sequence as S

data GenesisInfo = GenesisInfo
  { parentHash :: Keccak256,
    addressInfo :: [AddressInfo],
    codeInfo :: [CodeInfo],
    stateRoot :: StateRoot,
    transactionsRoot :: StateRoot,
    receiptsRoot :: StateRoot,
    logBloom :: B.ByteString,
    number :: Integer,
    timestamp :: UTCTime,
    extraData :: Integer,
    events :: M.Map Address (S.Seq Event),
    delegatecalls :: M.Map Address (S.Seq Delegatecall),
    validators :: [Validator]
  }
  deriving (Show, Read, Eq, Generic)

instance Format GenesisInfo where
  format GenesisInfo{..} =
    "GenesisInfo\n" ++ tab (
    "parentHash: " ++ format parentHash ++ "\n"
    ++ "addressInfo:\n"
    ++  tab (unlines $ map format addressInfo) ++ "\n"
    ++ "codeInfo:\n"
    ++  tab (unlines $ map format codeInfo) ++ "\n"
    ++ "stateRoot: " ++ format stateRoot ++ "\n"
    ++ "transactionsRoot: " ++ format transactionsRoot ++ "\n"
    ++ "receiptsRoot: " ++ format receiptsRoot ++ "\n"
    ++ "logBloom: " ++ format logBloom ++ "\n"
    ++ "number: " ++ show number ++ "\n"
    ++ "timestamp: " ++ show timestamp ++ "\n"
    ++ "extraData: " ++ show extraData ++ "\n"
    ++ "validators:\n"
    ++  tab (unlines $ map format validators)
    )

nullStateRoot :: StateRoot
nullStateRoot =
  StateRoot . LabeledError.b16Decode "nullStateRoot" $
    "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"

instance Default GenesisInfo where
  def =
    GenesisInfo
    { parentHash = unsafeCreateKeccak256FromWord256 0,
      addressInfo = [],
      codeInfo = [],
      stateRoot = nullStateRoot,
      transactionsRoot = nullStateRoot,
      receiptsRoot = nullStateRoot,
      logBloom = B.replicate 512 0,
      number = 0,
      timestamp = read "1970-01-01 00:00:00 UTC" :: UTCTime,
      extraData = 0,
      events = M.empty,
      delegatecalls = M.empty,
      validators = []
    }

instance FromJSON GenesisInfo where

instance ToJSON GenesisInfo where

getGenesisInfo :: MonadIO m => m GenesisInfo
getGenesisInfo = do
  theJSONString <- liftIO $ BLC.readFile "genesis.json"
  case JS.eitherDecode theJSONString of
    Left e -> error $ "Failed to parse genesis.json: " ++ show e
    Right genesisInfo -> return genesisInfo
