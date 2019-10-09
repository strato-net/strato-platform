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

import           Handler.Common
import           Handler.Filters
import           Import

import           Blockchain.Data.Address
import           Blockchain.SolidVM.Model

import qualified Database.Esqueleto      as E
import qualified Prelude                 as P
import qualified Data.Text               as T

data StorageAddress = StorageAddress {
    key     :: HexStorage,
    value   :: HexStorage,
    kind    :: CodeKind,
    address :: Address
} deriving (Show, Read, Eq, Generic)

instance ToJSON StorageAddress

storage2StorageAddress :: Storage -> Address -> StorageAddress
storage2StorageAddress stor addr = (StorageAddress (storageKey stor) (storageValue stor) (storageKind stor) addr)

getStorageInfoR :: HandlerFor App Value
getStorageInfoR = do
                 getParameters <- reqGetParams <$> getRequest

                 chainIds <- lookupGetParams "chainid"

                 limit <- liftIO $ myFetchLimit

                 addHeader "Access-Control-Allow-Origin" "*"

                 addrs <- runDB $ E.select . E.distinct $

                                        E.from $ \(storage `E.InnerJoin` addrStRef) -> do

                                        let matchChainId cid = ((addrStRef E.^. AddressStateRefChainId) E.==. (E.val $ fromHexText cid))

                                        let chainCriteria = case chainIds of
                                              [] -> [(addrStRef E.^. AddressStateRefChainId) E.==. E.val 0]
                                              [cid] -> if (T.unpack cid == "main")
                                                           then  [(addrStRef E.^. AddressStateRefChainId) E.==. E.val 0]
                                                           else if (T.unpack cid == "all")
                                                                    then []
                                                                    else [matchChainId cid]
                                              cids -> P.map matchChainId cids

                                        let criteria = (storage E.^. StorageAddressStateRefId E.==. addrStRef E.^. AddressStateRefId)

                                        E.on (P.foldl1 (E.||.) $ P.map (criteria E.&&.) chainCriteria)

                                        E.where_ ((P.foldl1 (E.&&.) $ P.map (getStorageFilter (storage,addrStRef)) $ getParameters ))

                                        E.limit $ limit

                                        E.orderBy [E.asc (storage E.^. StorageKey)]

                                        return (storage, addrStRef E.^. AddressStateRefAddress)

                 let storageRecords = P.map (entityVal . fst) addrs
                     storageAddresses = P.zipWith (storage2StorageAddress) storageRecords (P.map (E.unValue . snd) addrs)

                 returnJson $ storageAddresses

