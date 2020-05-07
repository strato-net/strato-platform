{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Storage (
  API,
  server
  ) where

import           Control.Monad.IO.Class
import           Data.Aeson
import           Data.Maybe
import           Data.Text               (Text)
import qualified Data.Text               as T
import qualified Database.Esqueleto      as E
import           Database.Persist.Postgresql
import           GHC.Generics
import           Numeric
import           Servant

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.ExtWord
import           Blockchain.SolidVM.Model

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
            :> QueryParam "chainid" Text
            :> QueryParams "chainids" Text
            :> Get '[JSON] Value

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

storage2StorageAddress :: Storage -> Address -> StorageAddress
storage2StorageAddress stor addr = (StorageAddress (storageKey stor) (storageValue stor) (storageKind stor) addr)

getStorage :: ConnectionPool ->
              Maybe HexStorage -> Maybe HexStorage -> Maybe HexStorage -> Maybe HexStorage ->
              Maybe HexStorage -> Maybe HexStorage -> Maybe Address ->
              Maybe Text -> [Text] -> Handler Value
getStorage pool
  theKey minkey maxkey theValue
  minvalue maxvalue theAddress
  chainidParam chainidsParam
  = do
  chainIds <-
    case (chainidParam, chainidsParam) of
      (Nothing, []) -> return []
      (Nothing, c) -> return c
      (Just c, []) -> return [c]
      _ -> throwError err400{ errBody = "You can't use both the chainid and chainids parameters at the same time" }
          
  addrs <- liftIO $ runSQLM pool $ sqlQuery $ E.select . E.distinct $

           E.from $ \(storage `E.InnerJoin` addrStRef) -> do

           let matchChainId cid = ((addrStRef E.^. AddressStateRefChainId) E.==. (E.val $ fromHexText cid))

           let chainCriteria =
                 case chainIds of
                   [] -> [(addrStRef E.^. AddressStateRefChainId) E.==. E.val 0]
                   [cid] -> if (T.unpack cid == "main")
                            then  [(addrStRef E.^. AddressStateRefChainId) E.==. E.val 0]
                            else if (T.unpack cid == "all")
                                 then [E.val True]
                                 else [matchChainId cid]
                   cids -> map matchChainId cids

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

  return . toJSON $ storageAddresses










{-
toHex :: Text -> HexStorage
toHex = word256ToHexStorage . read . T.unpack
-}

fromHexText :: T.Text -> Word256
fromHexText v = res
  where ((res,_):_) = readHex $ T.unpack $ v :: [(Word256,String)]

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
