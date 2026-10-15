{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Data.AddressStateRef where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Keccak256
import Control.Monad
import qualified Database.Persist.Postgresql as SQL hiding (Update, get)
import UnliftIO (MonadUnliftIO)

addressStateRefCodePtr :: AddressStateRef -> Maybe CodePtr
addressStateRefCodePtr AddressStateRef {..} = case addressStateRefContractName of
  Just name -> SolidVMCode name <$> addressStateRefCodeHash
  Nothing -> Nothing

updateSQLBalanceAndNonce ::
  HasSQLDB m =>
  [(Address, (Integer, Integer))] ->
  m ()
updateSQLBalanceAndNonce = sqlQueryWriter . updateSQLBalanceAndNonceSql

-- | The upserts as one 'SQL.SqlPersistT' action, for a caller that commits
-- them inside a larger transaction (the indexer's fenced batch).
updateSQLBalanceAndNonceSql ::
  MonadUnliftIO m =>
  [(Address, (Integer, Integer))] ->
  SQL.SqlPersistT m ()
updateSQLBalanceAndNonceSql vals =
    forM_ vals $ \(a, (v, n)) -> do
      let asr =
            AddressStateRef
              { addressStateRefAddress = a,
                addressStateRefNonce = n,
                addressStateRefBalance = v,
                addressStateRefContractRoot = MP.emptyTriePtr,
                -- addressStateRefCode = "",
                addressStateRefCodeHash = Just $ hash "",
                addressStateRefContractName = Nothing,
                addressStateRefLatestBlockDataRefNumber = 0
              }
      SQL.upsert
        asr
        [ AddressStateRefAddress SQL.=. a,
          AddressStateRefNonce SQL.=. n,
          AddressStateRefBalance SQL.=. v
        ]
