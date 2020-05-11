{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators    #-}

module Blockchain.Data.Extra
    ( getGenesisHash
    , putGenesisHash
    ) where

import           Control.Monad               (void)
import qualified Database.Persist.Sql        as SQL

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.Keccak256

getGenesisHash :: HasSQLDB m => m Keccak256
getGenesisHash = sqlQuery $ read . extraValue <$> SQL.getJust (ExtraKey "genesisHash")

putGenesisHash :: HasSQLDB m => Keccak256 -> m ()
putGenesisHash hash' = void . sqlQuery $ SQL.upsert (Extra "genesisHash" $ show hash') []
