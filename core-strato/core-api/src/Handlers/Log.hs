{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Log (
  API,
  server
  ) where


import           Control.Monad.IO.Class
import           Data.List
import           Data.Maybe
import qualified Database.Esqueleto            as E
import           Database.Persist.Postgresql
import           Servant

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json          ()
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.SHA   hiding (hash)

import           Settings
import           SortDirection
import           SQLM

type API = 
  "log" :> QueryParam "address" Address
        :> QueryParam "hash" SHA
        :> QueryParam "sortby" Sortby
        :> Get '[JSON] [LogDB]


server :: ConnectionPool -> Server API
server pool = getLog pool

---------------------


getLog :: ConnectionPool -> Maybe Address -> Maybe SHA -> Maybe Sortby -> Handler [LogDB]
getLog pool address hash sortParam = liftIO $ runSQLM pool $ do
  logs <- sqlQuery $ E.select $ E.from $ \lg -> do
    let criteria = catMaybes
                   [
                     fmap (\v -> lg E.^. LogDBAddress E.==. E.val v) address,
                     fmap (\v -> lg E.^. LogDBTransactionHash  E.==. E.val v) hash,
                     Just $ E.val True -- added to keep the foldl1 from crashing
                   ]
    E.where_ (foldl1 (E.&&.) criteria)
    E.limit $ appFetchLimit
    -- E.orderBy [E.desc (lg E.^. LogDBId)]
    E.orderBy $ [(sortToOrderBy sortParam) $ (lg E.^. LogDBId)]
    return lg

  --let modLogs = (nub (map entityVal (logs :: [Entity LogDB])))

  return $ nub $ map E.entityVal logs







