{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Slipstream.MChainId where

import BlockApps.Ethereum
import Database.Persist.Sql
import Data.Aeson
import Data.LargeWord
import GHC.Generics

-- Why is this garbage here? Because persistent forces the new composite
-- key type to have Show and Read instances to use derivePeristField.
deriving instance Read Word128
deriving instance Read Word192
deriving instance Read Word256
deriving instance Read ChainId

-- Primary keys are not nullable, so avoid using persistent's Maybe modifier
newtype MChainId = MChainId { unMChainId :: Maybe ChainId } deriving (Show, Eq, Ord, Read, Generic)

instance PersistField MChainId where
  toPersistValue (MChainId Nothing) = PersistText "<no_chain>"
  toPersistValue (MChainId (Just ci)) = toPersistValue ci
  fromPersistValue v = if v == PersistText "<no_chain>"
                         then Right $ MChainId Nothing
                         else (MChainId . Just) <$> fromPersistValue v

instance PersistFieldSql MChainId where
  sqlType _ = SqlOther "text"

instance FromJSON MChainId where
instance ToJSON MChainId where
