{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Slipstream.Data.GlobalsColdStorage where

import ClassyPrelude hiding (Handle, (.))
import Database.Persist.Sql
import qualified Data.Aeson as Ae
import Data.LargeWord

import BlockApps.Ethereum
import BlockApps.Solidity.Value

data QueueElem = PreStorageEntry Address (Maybe ChainId) [(Text, Value)]
               | SyncFlush

data Handle = Handle (TQueue QueueElem) SqlBackend
            | FakeHandle

instance NFData Handle where
  rnf = const () -- It doesn't really make sense to force a handle

fakeHandle :: Handle
fakeHandle = FakeHandle

-- Why is this garbage here? Because persistent forces the new composite
-- key type to have Show and Read instances to use derivePeristField.
deriving instance Read Address
deriving instance Read ChainId
deriving instance Read Word128
deriving instance Read Word160
deriving instance Read Word192
deriving instance Read Word256

-- Primary keys are not nullable, so avoid using persistent's Maybe modifier
newtype MChainId = MChainId { unMChainId :: Maybe ChainId }
                   deriving (Show, Eq, Ord, Read, Generic, Ae.ToJSON, Ae.FromJSON)

instance PersistField MChainId where
  toPersistValue (MChainId Nothing) = PersistText "<no_chain>"
  toPersistValue (MChainId (Just ci)) = toPersistValue ci
  fromPersistValue v = if v == PersistText "<no_chain>"
                         then Right $ MChainId Nothing
                         else (MChainId . Just) <$> fromPersistValue v

instance PersistFieldSql MChainId where
  sqlType _ = SqlOther "text"
