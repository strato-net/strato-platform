{-# LANGUAGE FlexibleContexts #-}

module Blockchain.DB.DetailsDB
  ( getGenesisBlockHash,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Keccak256
import qualified Database.Esqueleto.Legacy as E

getGenesisBlockHash ::
  HasSQLDB m =>
  m Keccak256
getGenesisBlockHash = do
  ret <- sqlQuery $
    E.select $
      E.from $ \a -> do
        E.where_ (a E.^. BlockDataRefNumber E.==. E.val 0)
        return $ a E.^. BlockDataRefHash
  case ret of
    [x] -> return $ E.unValue x
    [] -> error "Ethereum DBs are blank, you need to set them up by running 'ethereum-setup'"
    _ -> error "getGenesisBlockHash called, but there are multiple genesis blocks!  This is an error."
