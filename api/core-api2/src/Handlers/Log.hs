{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Log (
  API,
  server
  ) where

import           Control.Monad.Change.Alter
import           Data.List
import           Data.Maybe
import qualified Database.Esqueleto            as E
import           Servant

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json          ()
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.Keccak256   hiding (hash)

import           Control.Monad.Composable.SQL

import           Settings
import           SortDirection

type API = 
  "log" :> QueryParam "address" Address
        :> QueryParam "hash" Keccak256
        :> QueryParam "sortby" Sortby
        :> Get '[JSON] [LogDB]


server :: HasSQL m => ServerT API m
server = getLog

---------------------

data LogsFilterParams = LogsFilterParams
  { qlAddress :: Maybe Address
  , qlHash    :: Maybe Keccak256
  , qlSortby  :: Maybe Sortby
  } deriving (Eq, Ord, Show)

instance HasSQL m => Selectable LogsFilterParams [LogDB] m where
  select _ LogsFilterParams{..} =
    fmap (Just . nub . map E.entityVal) . sqlQuery $ E.select $ E.from $ \lg -> do
      let criteria = catMaybes
                    [
                      fmap (\v -> lg E.^. LogDBAddress E.==. E.val v) qlAddress,
                      fmap (\v -> lg E.^. LogDBTransactionHash  E.==. E.val v) qlHash,
                      Just $ E.val True -- added to keep the foldl1 from crashing
                    ]
      E.where_ (foldl1 (E.&&.) criteria)
      E.limit $ appFetchLimit
      -- E.orderBy [E.desc (lg E.^. LogDBId)]
      E.orderBy $ [(sortToOrderBy qlSortby) $ (lg E.^. LogDBId)]
      return lg

getLog :: Selectable LogsFilterParams [LogDB] m => Maybe Address -> Maybe Keccak256 -> Maybe Sortby -> m [LogDB]
getLog a b c = fromMaybe [] <$> select (Proxy @[LogDB]) (LogsFilterParams a b c)
