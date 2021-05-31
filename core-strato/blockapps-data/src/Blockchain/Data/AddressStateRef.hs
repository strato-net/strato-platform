{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.Data.AddressStateRef where

import           Control.Monad
import           Control.Monad.FT
import           Data.Maybe
import qualified Database.Persist.Postgresql        as SQL hiding (Update, get)

import           Blockchain.Data.DataDefs
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256

updateSQLBalanceAndNonce :: HasSQLDB m =>
                            [(Account, (Integer, Integer))] -> m ()
updateSQLBalanceAndNonce vals = do
  pool <- unSQLDB <$> get
  flip SQL.runSqlPool pool $ do
    forM_ vals $ \((Account a c), (v, n)) -> do
      let asr =
            AddressStateRef{
              addressStateRefAddress = a,
              addressStateRefNonce = n,
              addressStateRefBalance = v,
              addressStateRefContractRoot = MP.emptyTriePtr,
              addressStateRefCode = "",
              addressStateRefCodeHash = EVMCode $ hash "",
              addressStateRefChainId = fromMaybe 0 c,
              addressStateRefLatestBlockDataRefNumber = 0
            }
      SQL.upsert asr [
        AddressStateRefAddress SQL.=. a,
        AddressStateRefChainId SQL.=. fromMaybe 0 c,
        AddressStateRefNonce SQL.=. n,
        AddressStateRefBalance SQL.=. v
        ]


