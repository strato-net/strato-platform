{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , DeriveGeneric
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
    , GeneralizedNewtypeDeriving
    , FlexibleInstances
#-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.Data.Action where

import            BlockApps.Ethereum
import            Data.Map.Strict         (Map)
import qualified  Data.Map.Strict         as M
import            Data.Text               (Text)
import qualified  Data.Text               as T
import            Data.Time
import            Data.LargeWord          (Word256)
import            Data.Aeson
import            GHC.Generics

data ActionType = Create | Delete | Update deriving (Eq,Show, Generic)

data SourcePtr = SourcePtr { sourceHash :: Keccak256, contractName :: Text} deriving (Eq, Show, Generic)

data Action = Action
  { actionType            :: ActionType -- either Create, Delete, or Update
  , actionBlockHash       :: Keccak256
  , actionBlockTimestamp  :: UTCTime
  , actionBlockNumber     :: Integer
  , actionTxHash          :: Keccak256
  , actionTxChainId       :: Maybe ChainId
  , actionTxSender        :: Address
  , actionAddress         :: Address
  , actionCodeHash        :: Keccak256
  , actionSourcePtr       :: Maybe SourcePtr
  , actionStorage         :: Maybe (Map (Hex Word256) (Hex Word256))
  } deriving (Show, Generic)

instance FromJSON Action
instance FromJSON ActionType
instance FromJSON SourcePtr
instance FromJSONKey (Hex Word256) where
    fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

formatAction :: Action -> Text
formatAction Action{..} = T.concat
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
  , tshow (maybe 0 M.size actionStorage)
  , " items\n"
  , "    codeHash = "
  , tshow actionCodeHash
  , "\n"
  , "    sourcePtr = "
  , tshow actionSourcePtr
  ]
  where tshow :: Show a => a -> Text
        tshow = T.pack . show
