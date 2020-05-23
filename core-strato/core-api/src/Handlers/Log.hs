{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Log (
  API,
  server
  ) where

import           Data.List
import           Data.Maybe
import qualified Database.Esqueleto            as E
import           Servant

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json          ()
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.Keccak256   hiding (hash)

import           Settings
import           SortDirection
import           SQLM

type API = 
  "log" :> QueryParam "address" Address
        :> QueryParam "hash" Keccak256
        :> QueryParam "sortby" Sortby
        :> Get '[JSON] [LogDB]


server :: ServerT API SQLM
server = getLog

---------------------


getLog :: Maybe Address -> Maybe Keccak256 -> Maybe Sortby -> SQLM [LogDB]
getLog address hash sortParam = do
  logs <- fmap (map E.entityVal) . sqlQuery $ E.select $ E.from $ \lg -> do
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

  return $ nub logs







