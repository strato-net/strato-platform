{-# LANGUAGE OverloadedStrings     #-}

module Blockchain.Data.AddressStateRef where

import           Control.Monad
import qualified Database.Persist.Postgresql                 as SQL hiding (Update, get)

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import qualified Blockchain.Database.MerklePatricia      as MP
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.SHA


updateSQLBalanceAndNonce :: HasSQLDB m =>
                            [(Address, (Integer, Integer))] -> m ()
updateSQLBalanceAndNonce vals = do
  pool <- getSQLDB
  flip SQL.runSqlPool pool $ do
    forM_ vals $ \(a, (v, n)) -> do
      let asr =
            AddressStateRef{
              addressStateRefAddress = a,
              addressStateRefNonce = n,
              addressStateRefBalance = v,
              addressStateRefContractRoot = MP.emptyTriePtr,
              addressStateRefCode = "",
              addressStateRefCodeHash = hash "",
              addressStateRefChainId = Nothing,
              addressStateRefLatestBlockDataRefNumber = 0
            }
      SQL.upsert asr [AddressStateRefAddress SQL.=. a, AddressStateRefNonce SQL.=. n, AddressStateRefBalance SQL.=. v]


