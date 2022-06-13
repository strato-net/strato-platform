{-# LANGUAGE
      DeriveAnyClass
    , DeriveGeneric
    , OverloadedStrings
    , RecordWildCards
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
    , GeneralizedNewtypeDeriving
    , FlexibleInstances
#-}

module Slipstream.Data.Action where

import           Control.DeepSeq
import           Data.Map.Strict         (Map)
import qualified Data.Map.Strict         as M
import           Data.Maybe              (fromMaybe,listToMaybe)
import           Data.Text               (Text)
import qualified Data.Text               as T
import           Data.Time
import           GHC.Generics

import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Stream.Action (Action)
import qualified Blockchain.Stream.Action as Action ( Action(..), ActionData(..), DataDiff(..), CallType(..))


data AggregateAction = AggregateAction
  { actionBlockHash      :: Keccak256
  , actionBlockTimestamp :: UTCTime
  , actionBlockNumber    :: Integer
  , actionTxHash         :: Keccak256
  , actionTxSender       :: Account
  , actionOrganization   :: Text
  , actionApplication    :: Text
  , actionAccount        :: Account
  , actionCodeHash       :: CodePtr
  , actionStorage        :: Action.DataDiff
  , actionType           :: Action.CallType
  , actionMetadata       :: Map Text Text
  } deriving (Show, Generic, NFData)


flatten :: Action -> [AggregateAction]
flatten Action.Action{..} = flip map (M.toList _actionData) $
  \(account, Action.ActionData{..}) -> -- It's a Create because I said so
    let t = fromMaybe Action.Create $ listToMaybe _actionDataCallTypes
     in AggregateAction
          { actionBlockHash      = _blockHash
          , actionBlockTimestamp = _blockTimestamp
          , actionBlockNumber    = _blockNumber
          , actionTxHash         = _transactionHash
          , actionTxSender       = _transactionSender
          , actionOrganization   = _actionDataOrganization
          , actionApplication    = _actionDataApplication
          , actionAccount        = account
          , actionCodeHash       = _actionDataCodeHash
          , actionStorage        = _actionDataStorageDiffs
          , actionType           = t
          , actionMetadata       = fromMaybe M.empty _metadata
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
  , (case _accountChainId actionAccount of
       Nothing -> ""
       Just c -> T.concat ["in chain", tshow c])
  , " with account: "
  , tshow (_accountAddress actionAccount)
  , " with "
  , tshow (case actionStorage of
      Action.EVMDiff m -> M.size m
      Action.SolidVMDiff m -> M.size m)
  , " items\n"
  , "    codeHash = "
  , tshow actionCodeHash
  ]
  where tshow :: Show a => a -> Text
        tshow = T.pack . show
