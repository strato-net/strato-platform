{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.Data.GlobalsColdStorage where

import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.ChainId
import ClassyPrelude hiding (Handle, (.))
import qualified Data.Aeson as Ae
import Database.Persist.Sql

data QueueElem
  = PreStorageEntry Account [(Text, Value)]
  | SyncFlush

data Handle
  = Handle (TQueue QueueElem) SqlBackend
  | FakeHandle

instance NFData Handle where
  rnf = const () -- It doesn't really make sense to force a handle

fakeHandle :: Handle
fakeHandle = FakeHandle

-- Why is this garbage here? Because persistent forces the new composite
-- key type to have Show and Read instances to use derivePeristField.
deriving instance Read ChainId

-- Primary keys are not nullable, so avoid using persistent's Maybe modifier
newtype MChainId = MChainId {unMChainId :: Maybe ChainId}
  deriving (Show, Eq, Ord, Read, Generic, Ae.ToJSON, Ae.FromJSON)

instance PersistField MChainId where
  toPersistValue (MChainId Nothing) = PersistText "<no_chain>"
  toPersistValue (MChainId (Just ci)) = toPersistValue ci
  fromPersistValue v =
    if v == PersistText "<no_chain>"
      then Right $ MChainId Nothing
      else (MChainId . Just) <$> fromPersistValue v

instance PersistFieldSql MChainId where
  sqlType _ = SqlOther "text"
