{-# LANGUAGE DeriveDataTypeable
           , EmptyDataDecls
           , FlexibleContexts
           , FlexibleInstances
           , FunctionalDependencies
           , MultiParamTypeClasses
           , TypeFamilies
           , UndecidableInstances
           , GADTs
           , DeriveGeneric
 #-}

module Handler.StorageInfo where

import Import
import Handler.Common 
import Handler.Filters

import Blockchain.Data.Address
import Blockchain.ExtWord (Word256)

import qualified Database.Esqueleto as E
import qualified Prelude as P

data StorageAddress = StorageAddress {
    key :: Word256,
    value :: Word256,
    address :: Address
} deriving (Show, Read, Eq, Generic)

instance ToJSON StorageAddress

storage2StorageAddress :: Storage -> Address -> StorageAddress
storage2StorageAddress stor addr = (StorageAddress (storageKey stor) (storageValue stor) addr)

getStorageInfoR :: Handler Value
getStorageInfoR = do
                 getParameters <- reqGetParams <$> getRequest
                 
                 appNameMaybe <- lookupGetParam "appname"
                 case appNameMaybe of
                     (Just t) -> liftIO $ putStrLn $ t
                     (Nothing) -> liftIO $ putStrLn "anon"

                 limit <- liftIO $ myFetchLimit

                 addHeader "Access-Control-Allow-Origin" "*"

                 addrs <- runDB $ E.select . E.distinct $

                                        E.from $ \(storage `E.InnerJoin` addrStRef) -> do
                        
                                        E.on ( storage E.^. StorageAddressStateRefId E.==. addrStRef E.^. AddressStateRefId )                                        

                                        E.where_ ((P.foldl1 (E.&&.) $ P.map (getStorageFilter (storage,addrStRef)) $ getParameters ))

                                        E.limit $ limit

                                        E.orderBy [E.asc (storage E.^. StorageKey)]

                                        return (storage, addrStRef E.^. AddressStateRefAddress)

                 let storageRecords = P.map (entityVal . fst) addrs 
                     storageAddresses = P.zipWith (storage2StorageAddress) storageRecords (P.map (E.unValue . snd) addrs)

                 returnJson $ storageAddresses
                  
