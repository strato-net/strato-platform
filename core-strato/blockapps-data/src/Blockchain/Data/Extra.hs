
module Blockchain.Data.Extra
    ( getGenesisHash
    , putGenesisHash
    ) where

import           Control.Monad               (void)
import qualified Database.Persist.Sql        as SQL

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.SHA

getGenesisHash :: HasSQLDB m => m SHA
getGenesisHash = sqlQuery $ read . extraValue <$> SQL.getJust (ExtraKey "genesisHash")

putGenesisHash :: HasSQLDB m => SHA -> m ()
putGenesisHash hash' = void . sqlQuery $ SQL.upsert (Extra "genesisHash" $ show hash') []
