{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Storage
  ( API,
    StorageFilterParams (..),
    storageFilterParams,
    getStorageClient,
    server,
    StorageAddress (..),
    getStorage',
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Address
import Control.Arrow ((***))
import Control.Monad.Change.Alter
import Control.Monad.Composable.SQL
import Data.Aeson
import Data.Foldable (for_)
import Data.Maybe
import Data.Swagger hiding (name)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Database.Esqueleto.Internal.Internal as E
import Database.Persist.Postgresql
import GHC.Generics
import Numeric.Natural
import Servant
import Servant.Client
import Settings

type API =
  "storage" :> QueryParam "key" Text
    :> QueryParam "minkey" Text
    :> QueryParam "maxkey" Text
    :> QueryParam "value" Text
    :> QueryParam "minvalue" Text
    :> QueryParam "maxvalue" Text
    :> QueryParam "search" Text
    :> QueryParam "address" Address
    :> QueryParam "offset" Natural
    :> QueryParam "limit" Natural
    :> Get '[JSON] [StorageAddress]

data StorageFilterParams = StorageFilterParams
  { qsKey :: Maybe Text,
    qsMinKey :: Maybe Text,
    qsMaxKey :: Maybe Text,
    qsValue :: Maybe Text,
    qsMinValue :: Maybe Text,
    qsMaxValue :: Maybe Text,
    qsSearch :: Maybe Text,
    qsAddress :: Maybe Address,
    qsOffset :: Maybe Natural,
    qsLimit :: Maybe Natural
  }
  deriving (Eq, Ord, Show)

storageFilterParams :: StorageFilterParams
storageFilterParams =
  StorageFilterParams
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing

getStorageClient :: StorageFilterParams -> ClientM [StorageAddress]
getStorageClient = uncurryStorageFilterParams getStorageClient'
  where
    getStorageClient' = client (Proxy @API)
    uncurryStorageFilterParams f StorageFilterParams {..} =
      f
        qsKey
        qsMinKey
        qsMaxKey
        qsValue
        qsMinValue
        qsMaxValue
        qsSearch
        qsAddress
        qsOffset
        qsLimit

server :: HasSQL m => ServerT API m
server = getStorage

-----------------------

data StorageAddress = StorageAddress
  { key :: Text,
    value :: Text,
    address :: Address
  }
  deriving (Show, Read, Eq, Generic)

instance ToJSON StorageAddress

instance FromJSON StorageAddress

instance ToSchema StorageAddress

storage2StorageAddress :: Storage -> Address -> StorageAddress
storage2StorageAddress stor addr = (StorageAddress (storageKey stor) (storageValue stor) addr)

instance HasSQL m => Selectable StorageFilterParams [StorageAddress] m where
  select _ StorageFilterParams {..} = do
    addrs <- fmap (map (entityVal *** E.unValue)) . sqlQuery $
      E.select . E.distinct $
        E.from $ \(storage `E.InnerJoin` addrStRef) -> do
          let criteria = (storage E.^. StorageAddressStateRefId E.==. addrStRef E.^. AddressStateRefId)

          E.on criteria

          let criteria2 =
                catMaybes
                  [ fmap (\v -> storage E.^. StorageKey E.==. E.val v) qsKey,
                    fmap (\v -> storage E.^. StorageKey E.>=. E.val v) qsMinKey,
                    fmap (\v -> storage E.^. StorageKey E.<=. E.val v) qsMaxKey,
                    fmap (\v -> storage E.^. StorageValue E.==. E.val v) qsValue,
                    fmap (\v -> storage E.^. StorageValue E.>=. E.val v) qsMinValue,
                    fmap (\v -> storage E.^. StorageValue E.<=. E.val v) qsMaxValue,
                    fmap (\search ->
                        let isWhiteSpace c = c `elem` [' ', '\n', '\t']
                            searches = filter (not . T.null) $ T.dropAround isWhiteSpace <$> T.split (==',') search
                            queries = (\v -> (E.unsafeSqlCastAs "TEXT" (addrStRef E.^. AddressStateRefAddress) `E.like` E.val (T.unpack $ "%" <> v <> "%"))
                                       E.||. (addrStRef E.^. AddressStateRefContractName `E.like` E.val (Just . T.unpack $ "%" <> v <> "%"))
                                       E.||. (storage E.^. StorageKey `E.like` E.val ("%" <> v <> "%"))
                                       E.||. (storage E.^. StorageValue `E.like` E.val ("%" <> v <> "%"))) <$> searches
                         in foldr (E.||.) (E.val False) queries
                      ) qsSearch,
                    -- Note: a join is done in StorageInfo
                    fmap (\v -> addrStRef E.^. AddressStateRefAddress E.==. E.val v) qsAddress
                  ]

          E.where_ (foldl1 (E.&&.) criteria2)

          E.offset . fromIntegral $ fromMaybe 0 qsOffset
          case qsAddress of
            Nothing -> E.limit $ maybe appFetchLimit (min appFetchLimit . fromIntegral) qsLimit
            Just _ -> for_ qsLimit $ E.limit . fromIntegral

          E.orderBy [E.asc (storage E.^. StorageKey)]

          return (storage, addrStRef E.^. AddressStateRefAddress)

    pure . Just $ uncurry storage2StorageAddress <$> addrs

getStorage ::
  Selectable StorageFilterParams [StorageAddress] m =>
  Maybe Text ->
  Maybe Text ->
  Maybe Text ->
  Maybe Text ->
  Maybe Text ->
  Maybe Text ->
  Maybe Text ->
  Maybe Address ->
  Maybe Natural ->
  Maybe Natural ->
  m [StorageAddress]
getStorage a b c d e f g h i j =
  getStorage' (StorageFilterParams a b c d e f g h i j)

getStorage' ::
  Selectable StorageFilterParams [StorageAddress] m =>
  StorageFilterParams ->
  m [StorageAddress]
getStorage' a = fromMaybe [] <$> select (Proxy @[StorageAddress]) a
