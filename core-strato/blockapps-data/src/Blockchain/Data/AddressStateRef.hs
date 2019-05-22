{-# LANGUAGE OverloadedStrings     #-}

module Blockchain.Data.AddressStateRef where

import           Control.Monad
import           Data.Maybe
import qualified Database.Persist.Postgresql                 as SQL hiding (Update, get)

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import qualified Blockchain.Database.MerklePatricia      as MP
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.SHA

import Blockchain.Strato.Model.ExtendedWord

updateSQLBalanceAndNonce :: HasSQLDB m =>
                            [((Address, Maybe Word256), (Integer, Integer))] -> m ()
updateSQLBalanceAndNonce vals = do
  pool <- getSQLDB
  flip SQL.runSqlPool pool $ do
    forM_ vals $ \((a, c), (v, n)) -> do
      let asr =
            AddressStateRef{
              addressStateRefAddress = a,
              addressStateRefNonce = n,
              addressStateRefBalance = v,
              addressStateRefContractRoot = MP.emptyTriePtr,
              addressStateRefCode = "",
              addressStateRefCodeHash = hash "",
              addressStateRefChainId = fromMaybe 0 c,
              addressStateRefLatestBlockDataRefNumber = 0
            }
      SQL.upsert asr [
        AddressStateRefAddress SQL.=. a,
        AddressStateRefChainId SQL.=. fromMaybe 0 c,
        AddressStateRefNonce SQL.=. n,
        AddressStateRefBalance SQL.=. v
        ]


