{-# LANGUAGE DeriveGeneric        #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.Action where

import           Blockchain.Data.Address
import           Blockchain.ExtWord      (Word256)
import           Blockchain.SHA
import           Data.Aeson
import           Data.Map.Strict         (Map)
import           Data.Text               (Text)
import           Data.Time
import           GHC.Generics

data ActionType = Create | Delete | Update deriving (Eq, Show, Generic)

instance ToJSON ActionType where
instance FromJSON ActionType where

data SourcePtr = SourcePtr { sourceHash :: Text, contractName :: Text} deriving (Eq, Show, Generic)

instance ToJSON SourcePtr where
instance FromJSON SourcePtr where

data Action = Action
  { actionType         :: ActionType
  , blockHash          :: SHA
  , blockTimestamp     :: UTCTime
  , blockNumber        :: Integer
  , transactionHash    :: SHA
  , transactionChainId :: Maybe Word256
  , transactionSender  :: Address
  , address            :: Address
  , codeHash           :: SHA
  , sourcePtr          :: Maybe SourcePtr
  , storage            :: Maybe (Map Word256 Word256)
  } deriving (Show, Generic)

instance ToJSON Action where
instance FromJSON Action where

instance FromJSONKey Word256 where
