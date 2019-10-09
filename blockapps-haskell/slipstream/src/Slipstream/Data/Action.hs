{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
    , GeneralizedNewtypeDeriving
    , FlexibleInstances
#-}

module Slipstream.Data.Action
  ( module Blockchain.Strato.Model.Action
  , module Slipstream.Data.Action
  ) where

import           BlockApps.Ethereum
import           Control.DeepSeq
import           Data.Map.Strict         (Map)
import qualified Data.Map.Strict         as M
import           Data.Maybe              (fromMaybe,listToMaybe)
import           Data.Foldable           (toList)
import           Data.Text               (Text)
import qualified Data.Text               as T
import           Data.Time
import           GHC.Generics

import           Blockchain.Strato.Model.Action ( Action(..), ActionData(..), ActionDataDiff(..)
                                                , CallType(..), CallData(..))
import           Blockchain.Strato.Model.Event

data AggregateAction = AggregateAction
  { actionBlockHash      :: SHA
  , actionBlockTimestamp :: UTCTime
  , actionBlockNumber    :: Integer
  , actionTxHash         :: SHA
  , actionTxChainId      :: Maybe ChainId
  , actionTxSender       :: Address
  , actionAddress        :: Address
  , actionCodeHash       :: CodePtr
  , actionStorage        :: ActionDataDiff
  , actionType           :: CallType
  , actionCallData       :: [CallData]
  , actionMetadata       :: Map Text Text
  } deriving (Show, Generic, NFData)


flatten :: Action -> [AggregateAction]
flatten Action{..} = flip map (M.toList _actionData) $
  \(address, ActionData{..}) -> -- It's a Create because I said so
    let t = maybe Create _callDataType $ listToMaybe _actionDataCallData
     in AggregateAction
          { actionBlockHash      = _actionBlockHash
          , actionBlockTimestamp = _actionBlockTimestamp
          , actionBlockNumber    = _actionBlockNumber
          , actionTxHash         = _actionTransactionHash
          , actionTxChainId      = ChainId <$> _actionTransactionChainId
          , actionTxSender       = _actionTransactionSender
          , actionAddress        = address
          , actionCodeHash       = _actionDataCodeHash
          , actionStorage        = _actionDataStorageDiffs
          , actionType           = t
          , actionCallData       = _actionDataCallData
          , actionMetadata       = fromMaybe M.empty _actionMetadata
          }

formatAction :: AggregateAction -> Text
formatAction AggregateAction{..} = T.concat
  [ tshow actionType
  , ", blockHash: "
  , tshow actionBlockHash
  , ", blockTimestamp: "
  , tshow actionBlockTimestamp
  , ", blockNumber: "
  , tshow actionBlockNumber
  , ", transactionHash: "
  , tshow actionTxHash
  , ", "
  , (case actionTxChainId of
       Nothing -> ""
       Just c -> T.concat ["in chain", tshow c])
  , " with address: "
  , tshow actionAddress
  , " with "
  , tshow (case actionStorage of
      ActionEVMDiff m -> M.size m
      ActionSolidVMDiff m -> M.size m)
  , " items\n"
  , "    codeHash = "
  , tshow actionCodeHash
  ]
  where tshow :: Show a => a -> Text
        tshow = T.pack . show


data AggregateEvent = AggregateEvent
  { agEventBlockHash       :: SHA
  , agEventBlockTimestamp  :: UTCTime
  , agEventBlockNumber      :: Integer
  , agEventTxHash          :: SHA
  , agEventTxChainId       :: Maybe ChainId
  , agEventTxSender        :: Address
  , agEventName            :: Text
  , agEventArgs            :: Text
  } deriving (Show, Generic, NFData)


squash :: Action -> [AggregateEvent]
squash Action{..} = flip map (toList _actionEvents)
  (\ev -> AggregateEvent 
    { agEventBlockHash        = _actionBlockHash
    , agEventBlockTimestamp   = _actionBlockTimestamp
    , agEventBlockNumber      = _actionBlockNumber
    , agEventTxHash           = _actionTransactionHash
    , agEventTxChainId        = ChainId <$> _actionTransactionChainId
    , agEventTxSender         = _actionTransactionSender
    , agEventName             = T.pack (evName ev)
    , agEventArgs             = T.intercalate "," $ (map T.pack (evArgs ev))
    }
  )
 
