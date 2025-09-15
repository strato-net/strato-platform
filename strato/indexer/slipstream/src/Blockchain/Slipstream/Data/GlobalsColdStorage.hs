{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Slipstream.Data.GlobalsColdStorage where

import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import ClassyPrelude hiding (Handle, (.))
import Database.Persist.Sql

data QueueElem
  = PreStorageEntry Address [(Text, Value)]
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

