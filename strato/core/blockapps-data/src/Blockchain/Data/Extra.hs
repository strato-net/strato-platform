{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Data.Extra
  ( getGenesisHash,
    putGenesisHash,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Keccak256
import Control.Monad (void)
import qualified Database.Persist.Sql as SQL
import qualified LabeledError

getGenesisHash :: HasSQLDB m => m Keccak256
getGenesisHash = sqlQuery $ LabeledError.read "Extra/getGenesisHash" . extraValue <$> SQL.getJust (ExtraKey "genesisHash")

putGenesisHash :: HasSQLDB m => Keccak256 -> m ()
putGenesisHash hash' = void . sqlQuery $ SQL.upsertBy (TheKey "genesisHash") (Extra "genesisHash" $ show hash') []

