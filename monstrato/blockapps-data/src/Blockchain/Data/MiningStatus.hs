{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Data.MiningStatus where

import           Data.Aeson          hiding (Success)
import           Database.Persist.TH
import           GHC.Generics

data MiningStatus = Unmined | Mined
  deriving (Eq, Ord, Enum, Read, Show, Generic)

derivePersistField "MiningStatus"

instance FromJSON MiningStatus
instance ToJSON MiningStatus
