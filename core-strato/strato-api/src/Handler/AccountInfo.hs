{-# LANGUAGE DeriveDataTypeable     #-}
{-# LANGUAGE EmptyDataDecls         #-}
{-# LANGUAGE FlexibleContexts       #-}
{-# LANGUAGE FlexibleInstances      #-}
{-# LANGUAGE FunctionalDependencies #-}
{-# LANGUAGE GADTs                  #-}
{-# LANGUAGE MultiParamTypeClasses  #-}
{-# LANGUAGE TypeFamilies           #-}
{-# LANGUAGE UndecidableInstances   #-}

module Handler.AccountInfo where

import           Import

import           Handler.Common
import           Handler.Filters

import           Data.List
import qualified Data.Map           as Map
import qualified Database.Esqueleto as E

import qualified Data.Text          as T
import qualified Prelude            as P

accountInfo :: [(Text, Text)] -> Handler Value
accountInfo params = do
    limit <- liftIO $ myFetchLimit
 
    chainIds <- fmap (fmap fromHexText) $ lookupGetParams "chainid"

    let index'   = fromIntegral $ (maybe 0 id $ extractPage "index" params) :: Int64
    let paramMap = Map.fromList params
        paramMapRemoved = P.foldr (\param mp -> (Map.delete param mp)) paramMap accountQueryParams

    addHeader "Access-Control-Allow-Origin" "*"

    addrs <- case ((paramMapRemoved == Map.empty) && (paramMap /= Map.empty)) of
            False -> invalidArgs [T.concat ["Need one of: ", T.intercalate " , " $ accountQueryParams]]
            True ->  runDB $ E.select . E.distinct $
              E.from $ \(accStateRef) -> do

              let criteria = P.map (getAccFilter (accStateRef)) $ params 
              let chainCriteria = case chainIds of
                    [] -> [(E.isNothing $ accStateRef E.^. AddressStateRefChainId)]
                    cids -> P.map (\cid -> (accStateRef E.^. AddressStateRefChainId) E.==. (E.just $ E.val cid)) cids
              let otherCriteria = ((accStateRef E.^. AddressStateRefId) E.>=. E.val (E.toSqlKey index')) : criteria
              let allCriteria = P.map (\cc -> cc : otherCriteria) chainCriteria
 
              E.where_ (P.foldl1 (E.||.) (P.map (P.foldl1 (E.&&.)) allCriteria))

              E.limit $ limit

              E.orderBy [E.asc (accStateRef E.^. AddressStateRefAddress)]
              return accStateRef

    let modAccounts = nub $ addrs :: [Entity AddressStateRef]
    let newindex = pack $ show $ 1 + (E.fromSqlKey . E.entityKey $ P.last modAccounts)
    let extra p = P.zipWith extraFilter p (P.repeat (newindex))
    -- this should actually use URL encoding code from Yesod
    let next p = "/eth/v1.2/account?" P.++  (P.foldl1 (\a b -> (unpack a) P.++ "&" P.++ (unpack b)) $ P.map (\(k,v) -> (unpack k) P.++ "=" P.++ (unpack v)) (extra p))

    toRet (P.map E.entityVal modAccounts) (next $ appendIndex params)
  where
    toRet :: [AddressStateRef] -> String -> Handler Value
    toRet as gp = returnJson . P.map asrToAsrPrime . P.zip (P.repeat gp) $ as

getAccountInfoR :: Handler Value
getAccountInfoR = do
        getParameters <- reqGetParams <$> getRequest
        accountInfo getParameters
