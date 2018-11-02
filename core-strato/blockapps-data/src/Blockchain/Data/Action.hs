{-# LANGUAGE DeriveGeneric        #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.Action where

import           Blockchain.Data.Address
import           Blockchain.ExtWord           (Word256)
import           Blockchain.SHA
import           Control.DeepSeq
import           Data.Aeson
import           Data.Map.Strict              (Map)
import           Data.Text                    (Text)
import           Data.Time
import           GHC.Generics

data ActionType = Create | Delete | Update deriving (Eq, Show, Generic)

instance ToJSON ActionType where
instance FromJSON ActionType where
instance NFData ActionType where

data Action = Action
  { actionType           :: ActionType
  , actionBlockHash      :: SHA
  , actionBlockTimestamp :: UTCTime
  , actionBlockNumber    :: Integer
  , actionTxHash         :: SHA
  , actionTxChainId      :: Maybe Word256
  , actionTxSender       :: Address
  , actionAddress        :: Address
  , actionCodeHash       :: SHA
  , actionStorage        :: Maybe (Map Word256 Word256)
  , actionInput          :: Text
  , actionOutput         :: Text
  , actionMetadata       :: Maybe (Map Text Text)
  } deriving (Show, Generic)

instance ToJSON Action where
instance FromJSON Action where
