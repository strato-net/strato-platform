{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Storage
  ( API
  , StorageFilterParams(..)
  , storageFilterParams
  , getStorageClient
  , server
  , StorageAddress(..)
  , HexStorage(..)
  , CodeKind(..)
  ) where

import           Control.Monad.IO.Class
import           Data.Aeson
import qualified Data.ByteString.Lazy.Char8  as BLC
import           Data.Maybe
import           Data.Swagger            hiding (name)
import qualified Data.Text               as T
import qualified Database.Esqueleto      as E
import           Database.Persist.Postgresql
import           GHC.Generics
import           MaybeNamed
import           Servant
import           Servant.Client

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.SolidVM.Model
import           Blockchain.Strato.Model.ChainId

import           Settings
import           SQLM

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
            :> Get '[JSON] [StorageAddress]

data StorageFilterParams = StorageFilterParams
  { qsKey      :: Maybe HexStorage
  , qsMinKey   :: Maybe HexStorage
  , qsMaxKey   :: Maybe HexStorage
  , qsValue    :: Maybe HexStorage
  , qsMinValue :: Maybe HexStorage
  , qsMaxValue :: Maybe HexStorage
  , qsAddress  :: Maybe Address
  , qsChainId  :: Maybe (MaybeNamed ChainId)
  , qsChainIds :: [ChainId]
  }

storageFilterParams :: StorageFilterParams
storageFilterParams = StorageFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  []

getStorageClient :: StorageFilterParams -> ClientM [StorageAddress]
getStorageClient = uncurryStorageFilterParams getStorageClient'
  where
    getStorageClient' = client (Proxy @API)
    uncurryStorageFilterParams f StorageFilterParams{..} = f
      qsKey qsMinKey qsMaxKey qsValue qsMinValue qsMaxValue
      qsAddress qsChainId qsChainIds

server :: ConnectionPool -> Server API
server connStr = getStorage connStr


-----------------------


data StorageAddress = StorageAddress {
    key     :: HexStorage,
    value   :: HexStorage,
    kind    :: CodeKind,
    address :: Address
} deriving (Show, Read, Eq, Generic)

instance ToJSON StorageAddress
instance FromJSON StorageAddress
instance ToSchema StorageAddress

storage2StorageAddress :: Storage -> Address -> StorageAddress
storage2StorageAddress stor addr = (StorageAddress (storageKey stor) (storageValue stor) (storageKind stor) addr)

data NamedChainId = UnnamedChainIds [ChainId]
                  | MainChain
                  | AllChains

getStorage :: ConnectionPool ->
              Maybe HexStorage -> Maybe HexStorage -> Maybe HexStorage -> Maybe HexStorage ->
              Maybe HexStorage -> Maybe HexStorage -> Maybe Address ->
              Maybe (MaybeNamed ChainId) -> [ChainId] -> Handler [StorageAddress]
getStorage pool
  theKey minkey maxkey theValue
  minvalue maxvalue theAddress
  chainidParam chainidsParam
  = do
  chainids <-
    case (chainidParam, chainidsParam) of
      (Nothing, v) -> case v of
        [] -> pure MainChain
        cids -> pure $ UnnamedChainIds cids
      (Just c, []) -> case c of
        Unnamed cid -> pure $ UnnamedChainIds [cid]
        Named "main" -> pure MainChain
        Named "all" -> pure AllChains
        Named name -> throwError err400{errBody = BLC.pack . T.unpack $ "Expected chainid to be named 'main' or 'all', but got '" <> name <> "'." }
      _ -> throwError err400{ errBody = "You can not use both the chainid and chainids parameters togther." }

  addrs <- liftIO $ runSQLM pool $ sqlQuery $ E.select . E.distinct $

           E.from $ \(storage `E.InnerJoin` addrStRef) -> do

           let matchChainId (ChainId cid) = ((addrStRef E.^. AddressStateRefChainId) E.==. (E.val cid))
               chainCriteria = case chainids of
                                 MainChain -> [addrStRef E.^. AddressStateRefChainId E.==. E.val 0]
                                 UnnamedChainIds cids -> matchChainId <$> cids
                                 AllChains -> [E.val True]

           let criteria = (storage E.^. StorageAddressStateRefId E.==. addrStRef E.^. AddressStateRefId)

           E.on (foldl1 (E.||.) $ map (criteria E.&&.) chainCriteria)

           let criteria2 = catMaybes
                 [
                   fmap (\v -> storage E.^. StorageKey E.==. E.val v) theKey,
                   fmap (\v -> storage E.^. StorageKey E.>=. E.val v) minkey,
                   fmap (\v -> storage E.^. StorageKey E.<=. E.val v) maxkey,
                   fmap (\v -> storage E.^. StorageValue E.==. E.val v) theValue,
                   fmap (\v -> storage E.^. StorageValue E.>=. E.val v) minvalue,
                   fmap (\v -> storage E.^. StorageValue E.<=. E.val v) maxvalue,
                   -- Note: a join is done in StorageInfo
                   fmap (\v -> addrStRef E.^. AddressStateRefAddress E.==. E.val v) theAddress
                 ]

           E.where_ (foldl1 (E.&&.) criteria2)

           E.limit $ appFetchLimit

           E.orderBy [E.asc (storage E.^. StorageKey)]

           return (storage, addrStRef E.^. AddressStateRefAddress)

  let storageRecords = map (entityVal . fst) addrs
      storageAddresses = zipWith (storage2StorageAddress) storageRecords (map (E.unValue . snd) addrs)

  return storageAddresses










{-
toHex :: Text -> HexStorage
toHex = word256ToHexStorage . read . T.unpack
-}

{-

{-# LANGUAGE DeriveDataTypeable     #-}
{-# LANGUAGE EmptyDataDecls         #-}
{-# LANGUAGE FlexibleContexts       #-}
{-# LANGUAGE FlexibleInstances      #-}
{-# LANGUAGE FunctionalDependencies #-}
{-# LANGUAGE GADTs                  #-}
{-# LANGUAGE MultiParamTypeClasses  #-}
{-# LANGUAGE TypeFamilies           #-}
{-# LANGUAGE UndecidableInstances   #-}

module Handler.StorageInfo where


import           Blockchain.Data.Address



-}
