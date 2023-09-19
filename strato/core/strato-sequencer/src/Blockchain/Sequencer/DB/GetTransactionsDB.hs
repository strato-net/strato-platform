{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Sequencer.DB.GetTransactionsDB where

import Blockchain.Strato.Model.Keccak256
import Control.Monad.Change.Modify
import qualified Data.Set as S

newtype GetTransactionsDB = GetTransactionsDB {unGetTransactionsDB :: S.Set Keccak256}

type HasGetTransactionsDB = Modifiable GetTransactionsDB

emptyGetTransactionsDB :: GetTransactionsDB
emptyGetTransactionsDB = GetTransactionsDB S.empty

insertGetTransactionsDB :: HasGetTransactionsDB m => Keccak256 -> m ()
insertGetTransactionsDB chainId =
  modify_ Proxy $
    pure . GetTransactionsDB . S.insert chainId . unGetTransactionsDB

clearGetTransactionsDB :: HasGetTransactionsDB m => m ()
clearGetTransactionsDB = put (Proxy @GetTransactionsDB) emptyGetTransactionsDB
