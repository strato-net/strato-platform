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
    HexStorage (..),
    CodeKind (..),
    getStorage',
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Control.Arrow ((***))
import Control.Monad.Change.Alter
import Control.Monad.Composable.SQL
import Data.Aeson
import Data.Maybe
import Data.Swagger hiding (name)
import qualified Database.Esqueleto.Legacy as E
import Database.Persist.Postgresql
import GHC.Generics
import MaybeNamed
import Numeric.Natural
import SQLM
import Servant
import Servant.Client
import Settings
import UnliftIO

type API =
  "storage" :> QueryParam "key" HexStorage
    :> QueryParam "minkey" HexStorage
    :> QueryParam "maxkey" HexStorage
    :> QueryParam "value" HexStorage
    :> QueryParam "minvalue" HexStorage
    :> QueryParam "maxvalue" HexStorage
    :> QueryParam "address" Address
    :> QueryParam "chainid" (MaybeNamed ChainId)
    :> QueryParams "chainids" ChainId
    :> QueryParam "offset" Natural
    :> QueryParam "limit" Natural
    :> Get '[JSON] [StorageAddress]

data StorageFilterParams = StorageFilterParams
  { qsKey :: Maybe HexStorage,
    qsMinKey :: Maybe HexStorage,
    qsMaxKey :: Maybe HexStorage,
    qsValue :: Maybe HexStorage,
    qsMinValue :: Maybe HexStorage,
    qsMaxValue :: Maybe HexStorage,
    qsAddress :: Maybe Address,
    qsChainId :: Maybe (MaybeNamed ChainId),
    qsChainIds :: [ChainId],
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
    []
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
        qsAddress
        qsChainId
        qsChainIds
        qsOffset
        qsLimit

server :: HasSQL m => ServerT API m
server = getStorage

-----------------------

data StorageAddress = StorageAddress
  { key :: HexStorage,
    value :: HexStorage,
    kind :: CodeKind,
    address :: Address
  }
  deriving (Show, Read, Eq, Generic)

instance ToJSON StorageAddress

instance FromJSON StorageAddress

instance ToSchema StorageAddress

storage2StorageAddress :: Storage -> Address -> StorageAddress
storage2StorageAddress stor addr = (StorageAddress (storageKey stor) (storageValue stor) (storageKind stor) addr)

instance HasSQL m => Selectable StorageFilterParams [StorageAddress] m where
  select _ StorageFilterParams {..} = do
    chainids <-
      case (qsChainId, qsChainIds) of
        (Nothing, v) -> case v of
          [] -> pure MainChain
          cids -> pure $ UnnamedChainIds cids
        (Just c, []) -> case c of
          Unnamed cid -> pure $ UnnamedChainIds [cid]
          Named "main" -> pure MainChain
          Named "all" -> pure AllChains
          Named name -> throwIO . NamedChainError $ "Expected chainid to be named 'main' or 'all', but got '" <> name <> "'."
        _ -> throwIO $ AmbiguousChainError "You can not use both the chainid and chainids parameters togther."

    addrs <- fmap (map (entityVal *** E.unValue)) . sqlQuery $
      E.select . E.distinct $
        E.from $ \(storage `E.InnerJoin` addrStRef) -> do
          let matchChainId (ChainId cid) = ((addrStRef E.^. AddressStateRefChainId) E.==. (E.val cid))
              chainCriteria = case chainids of
                MainChain -> [addrStRef E.^. AddressStateRefChainId E.==. E.val 0]
                UnnamedChainIds cids -> matchChainId <$> cids
                AllChains -> [E.val True]

          let criteria = (storage E.^. StorageAddressStateRefId E.==. addrStRef E.^. AddressStateRefId)

          E.on (foldl1 (E.||.) $ map (criteria E.&&.) chainCriteria)

          let criteria2 =
                catMaybes
                  [ fmap (\v -> storage E.^. StorageKey E.==. E.val v) qsKey,
                    fmap (\v -> storage E.^. StorageKey E.>=. E.val v) qsMinKey,
                    fmap (\v -> storage E.^. StorageKey E.<=. E.val v) qsMaxKey,
                    fmap (\v -> storage E.^. StorageValue E.==. E.val v) qsValue,
                    fmap (\v -> storage E.^. StorageValue E.>=. E.val v) qsMinValue,
                    fmap (\v -> storage E.^. StorageValue E.<=. E.val v) qsMaxValue,
                    -- Note: a join is done in StorageInfo
                    fmap (\v -> addrStRef E.^. AddressStateRefAddress E.==. E.val v) qsAddress
                  ]

          E.where_ (foldl1 (E.&&.) criteria2)

          E.offset . fromIntegral $ fromMaybe 0 qsOffset
          E.limit $ maybe appFetchLimit (min appFetchLimit . fromIntegral) qsLimit

          E.orderBy [E.asc (storage E.^. StorageKey)]

          return (storage, addrStRef E.^. AddressStateRefAddress)

    pure . Just $ uncurry storage2StorageAddress <$> addrs

data NamedChainId
  = UnnamedChainIds [ChainId]
  | MainChain
  | AllChains

getStorage ::
  Selectable StorageFilterParams [StorageAddress] m =>
  Maybe HexStorage ->
  Maybe HexStorage ->
  Maybe HexStorage ->
  Maybe HexStorage ->
  Maybe HexStorage ->
  Maybe HexStorage ->
  Maybe Address ->
  Maybe (MaybeNamed ChainId) ->
  [ChainId] ->
  Maybe Natural ->
  Maybe Natural ->
  m [StorageAddress]
getStorage a b c d e f g h i j k =
  getStorage' (StorageFilterParams a b c d e f g h i j k)

getStorage' ::
  Selectable StorageFilterParams [StorageAddress] m =>
  StorageFilterParams ->
  m [StorageAddress]
getStorage' a = fromMaybe [] <$> select (Proxy @[StorageAddress]) a
