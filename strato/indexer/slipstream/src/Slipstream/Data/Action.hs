{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Slipstream.Data.Action where

import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.Keccak256
import Blockchain.Stream.Action (Action)
import qualified Blockchain.Stream.Action as Action (Action (..), ActionData (..), CallType (..), DataDiff (..))
import Control.DeepSeq
import Data.Aeson
import qualified Data.Aeson as JSON
import Data.Binary
import Data.Binary.Get
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import qualified Data.Map.Ordered as OMap
import Data.Maybe (fromMaybe, listToMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time
import GHC.Generics
import SolidVM.Model.CodeCollection hiding (Event)

data AggregateAction = AggregateAction
  { actionBlockHash :: Keccak256,
    actionBlockTimestamp :: UTCTime,
    actionBlockNumber :: Integer,
    actionTxHash :: Keccak256,
    actionTxSender :: Account,
    actionCreator :: Text,
    actionCCCreator :: Maybe Text,
    actionRoot :: Text,
    actionApplication :: Text,
    actionAccount :: Account,
    actionCodeHash :: CodePtr,
    actionCodeCollection :: CodeCollection,
    actionStorage :: Action.DataDiff,
    actionAbstracts :: Map (Account, Text) (Text, Text, [Text]),
    actionMappings :: [Text],
    actionArrays :: [Text],
    actionType :: Action.CallType,
    actionMetadata :: Map Text Text
  }
  deriving (Show, Generic, NFData)

data AggregateEvent = AggregateEvent
  { eventBlockHash :: Keccak256,
    eventBlockTimestamp :: UTCTime,
    eventBlockNumber :: Integer,
    eventTxHash :: Keccak256,
    eventTxSender :: Account,
    eventIndex :: Int,
    eventAbstracts :: Map (Account, Text) (Text, Text, [Text]),
    eventEvent :: Event
  }
  deriving (Show, Generic, NFData, ToJSON, FromJSON)

-- Binary encoding is set to JSON for now, since kafka monad lib encodes binary, and marketplace needs this as JSON
-- We probably should just offer a way to enocde json in kafka lib, but this will do for now
instance Binary AggregateEvent where
  put v = do
    put $ JSON.encode v
  get = do
    bytes <- getRemainingLazyByteString
    case JSON.decode bytes of
      Just val -> return val
      Nothing -> error "error decoding AggregateEvent"

flatten :: Action -> [AggregateAction]
flatten Action.Action {..} = flip map (OMap.assocs _actionData) $
  \(account, Action.ActionData {..}) ->
    -- It's a Create because I said so
    let t = fromMaybe Action.Create $ listToMaybe _actionDataCallTypes
     in AggregateAction
          { actionBlockHash = _blockHash,
            actionBlockTimestamp = _blockTimestamp,
            actionBlockNumber = _blockNumber,
            actionTxHash = _transactionHash,
            actionTxSender = _transactionSender,
            actionCreator = _actionDataCreator,
            actionCCCreator = _actionDataCCCreator,
            actionRoot = _actionDataRoot,
            actionApplication = _actionDataApplication,
            actionAccount = account,
            actionCodeHash = _actionDataCodeHash,
            actionCodeCollection = _actionDataCodeCollection,
            actionStorage = _actionDataStorageDiffs,
            actionAbstracts = _actionDataAbstracts,
            actionMappings = _actionDataMappings,
            actionArrays = _actionDataArrays,
            actionType = t,
            actionMetadata = fromMaybe M.empty _metadata
          }

formatAction :: AggregateAction -> Text
formatAction AggregateAction {..} =
  T.concat
    [ tshow actionType,
      ", blockHash: ",
      tshow actionBlockHash,
      ", blockTimestamp: ",
      tshow actionBlockTimestamp,
      ", blockNumber: ",
      tshow actionBlockNumber,
      ", transactionHash: ",
      tshow actionTxHash,
      ", ",
      ( case _accountChainId actionAccount of
          Nothing -> ""
          Just c -> T.concat ["in chain", tshow c]
      ),
      " with account: ",
      tshow (_accountAddress actionAccount),
      " with ",
      tshow
        ( case actionStorage of
            Action.EVMDiff m -> M.size m
            Action.SolidVMDiff m -> M.size m
        ),
      " items\n",
      "    codeHash = ",
      tshow actionCodeHash
    ]
  where
    tshow :: Show a => a -> Text
    tshow = T.pack . show
