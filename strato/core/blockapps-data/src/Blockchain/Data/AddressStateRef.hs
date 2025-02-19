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
import Control.Monad.Composable.Base
import qualified Database.Persist.Postgresql as SQL hiding (Update, get)

addressStateRefCodePtr :: AddressStateRef -> Maybe CodePtr
addressStateRefCodePtr AddressStateRef {..} = case addressStateRefContractName of
  Just name -> case addressStateRefCodePtrAddress of
    Just a -> Just $ CodeAtAccount a name
    Nothing -> SolidVMCode name <$> addressStateRefCodeHash
  Nothing -> Nothing

updateSQLBalanceAndNonce ::
  HasSQLDB m =>
  [(Address, (Integer, Integer))] ->
  m ()
updateSQLBalanceAndNonce vals = do
  pool <- unSQLDB <$> accessEnv
  flip SQL.runSqlPool pool $ do
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
                addressStateRefCodePtrAddress = Nothing,
                addressStateRefLatestBlockDataRefNumber = 0
              }
      SQL.upsert
        asr
        [ AddressStateRefAddress SQL.=. a,
          AddressStateRefNonce SQL.=. n,
          AddressStateRefBalance SQL.=. v
        ]
