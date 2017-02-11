{-# LANGUAGE DeriveDataTypeable
           , EmptyDataDecls
           , FlexibleContexts
           , FlexibleInstances
           , FunctionalDependencies
           , MultiParamTypeClasses
           , TypeFamilies
           , UndecidableInstances
           , GADTs
 #-}

module Handler.AccountInfo where

import Import

import Handler.Common 
import Handler.Filters

import qualified Database.Esqueleto as E
import Data.List
import qualified Data.Map as Map

import qualified Prelude as P
import qualified Data.Text as T

accountInfo :: [(Text, Text)] -> Handler Value
accountInfo params = do
    appNameMaybe <- lookupGetParam "appname"

    case appNameMaybe of
       (Just t) -> liftIO $ putStrLn $ t
       (Nothing) -> liftIO $ putStrLn "anon"

    limit <- liftIO $ myFetchLimit

    let index'   = fromIntegral $ (maybe 0 id $ extractPage "index" params) :: Int64
    let raw      = (fromIntegral $ (maybe 0 id $ extractPage "raw" params) :: Integer) > 0
    let paramMap = Map.fromList params
        paramMapRemoved = P.foldr (\param mp -> (Map.delete param mp)) paramMap accountQueryParams

    addHeader "Access-Control-Allow-Origin" "*"

    addrs <- case ((paramMapRemoved == Map.empty) && (paramMap /= Map.empty)) of
            False -> invalidArgs [T.concat ["Need one of: ", T.intercalate " , " $ accountQueryParams]]
            True ->  runDB $ E.select . E.distinct $
              E.from $ \(accStateRef) -> do

              let criteria = P.map (getAccFilter (accStateRef)) $ params 
              let allCriteria = ((accStateRef E.^. AddressStateRefId) E.>=. E.val (E.toSqlKey index')) : criteria

              E.where_ (P.foldl1 (E.&&.) allCriteria)

              E.limit $ limit

              E.orderBy [E.asc (accStateRef E.^. AddressStateRefAddress)]
              return accStateRef

    let modAccounts = nub $ addrs :: [Entity AddressStateRef]
    let newindex = pack $ show $ 1 + (E.fromSqlKey . E.entityKey $ P.last modAccounts)
    let extra p = P.zipWith extraFilter p (P.repeat (newindex))
    -- this should actually use URL encoding code from Yesod
    let next p = "/eth/v1.2/account?" P.++  (P.foldl1 (\a b -> (unpack a) P.++ "&" P.++ (unpack b)) $ P.map (\(k,v) -> (unpack k) P.++ "=" P.++ (unpack v)) (extra p))

    toRet raw (P.map E.entityVal modAccounts) (next $ appendIndex params)
  where
    toRet :: Bool -> [AddressStateRef] -> String -> Handler Value
    toRet raw as gp = case if' raw as (P.map asrToAsrPrime (P.zip (P.repeat gp) as)) of 
              Left a -> returnJson a
              Right b -> returnJson b

getAccountInfoR :: Handler Value
getAccountInfoR = do
        getParameters <- reqGetParams <$> getRequest
        accountInfo getParameters

postAccountCodeR :: Handler Value
postAccountCodeR = do
        (postParams, _) <- runRequestBody
        --liftIO $ traceIO $ show postParams
        accountInfo postParams











