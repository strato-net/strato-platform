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

module Blockchain.Slipstream.Data.Action where

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.Keccak256
import Blockchain.Stream.Action (Action)
import qualified Blockchain.Stream.Action as Action (Action (..), ActionData (..), DataDiff (..))
import Control.DeepSeq
import Data.Aeson
import qualified Data.Aeson as JSON
import Data.Binary
import Data.Binary.Get
import qualified Data.Map.Strict as M
import qualified Data.Map.Ordered as OMap
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
    actionTxSender :: Address,
    actionCreator :: Text,
    actionCCCreator :: Maybe Text,
    actionRoot :: Text,
    actionApplication :: Text,
    actionAddress :: Address,
    actionCodeHash :: CodePtr,
    actionCodeCollection :: CodeCollection,
    actionStorage :: Action.DataDiff,
    actionSrc :: Maybe Code
  }
  deriving (Show, Generic, NFData)

data AggregateEvent = AggregateEvent
  { eventBlockHash :: Keccak256,
    eventBlockTimestamp :: UTCTime,
    eventBlockNumber :: Integer,
    eventTxHash :: Keccak256,
    eventTxSender :: Address,
    eventIndex :: Int,
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
  \(address, Action.ActionData {..}) ->
    -- It's a Create because I said so
    AggregateAction
          { actionBlockHash = _blockHash,
            actionBlockTimestamp = _blockTimestamp,
            actionBlockNumber = _blockNumber,
            actionTxHash = _transactionHash,
            actionTxSender = _transactionSender,
            actionCreator = _actionDataCreator,
            actionCCCreator = _actionDataCCCreator,
            actionRoot = _actionDataRoot,
            actionApplication = _actionDataApplication,
            actionAddress = address,
            actionCodeHash = _actionDataCodeHash,
            actionCodeCollection = _actionDataCodeCollection,
            actionStorage = _actionDataStorageDiffs,
            actionSrc = _src
          }

formatAction :: AggregateAction -> Text
formatAction AggregateAction {..} =
  T.concat
    [ "blockHash: ",
      tshow actionBlockHash,
      ", blockTimestamp: ",
      tshow actionBlockTimestamp,
      ", blockNumber: ",
      tshow actionBlockNumber,
      ", transactionHash: ",
      tshow actionTxHash,
      ", ",
      " with account: ",
      tshow actionAddress,
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
