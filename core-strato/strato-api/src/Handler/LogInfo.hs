{-# LANGUAGE DeriveDataTypeable     #-}
{-# LANGUAGE EmptyDataDecls         #-}
{-# LANGUAGE FlexibleContexts       #-}
{-# LANGUAGE FlexibleInstances      #-}
{-# LANGUAGE FunctionalDependencies #-}
{-# LANGUAGE GADTs                  #-}
{-# LANGUAGE MultiParamTypeClasses  #-}
{-# LANGUAGE TypeFamilies           #-}
{-# LANGUAGE UndecidableInstances   #-}

module Handler.LogInfo where

import           Import

import           Handler.Common
import           Handler.Filters

import           Data.List
import qualified Database.Esqueleto as E

import qualified Prelude            as P



getLogInfoR :: HandlerFor App Value
getLogInfoR = do
                 getParameters <- reqGetParams <$> getRequest

                 let index' = fromIntegral (maybe 0 id $  extractPage "index" getParameters)  :: Int64

                 addHeader "Access-Control-Allow-Origin" "*"

                 limit <- liftIO $ myFetchLimit

                 sortParam <- lookupGetParam "sortby"

                 logs <- runDB $ E.select $
                                        E.from $ \(lg) -> do
                                        let criteria = P.map (getLogFilter lg) $ getParameters
                                        let allCriteria = ((lg E.^. LogDBId) E.>=. E.val (E.toSqlKey index')) : criteria
                                        E.where_ (P.foldl1 (E.&&.) allCriteria)
                                        E.limit $ limit
                                        -- E.orderBy [E.desc (lg E.^. LogDBId)]
                                        E.orderBy $ [(sortToOrderBy sortParam) $ (lg E.^. LogDBId)]
                                        return lg

                 --let modLogs = (nub (P.map entityVal (logs :: [Entity LogDB])))
                 --let newindex = pack $ show $ 1+(getLogNum $ P.last modLogs)
                 --let extra p = P.zipWith extraFilter p (P.repeat (newindex))
                 ---- this should actually use URL encoding code from Yesod
                 --let next p = "/eth/v1.2/log?" P.++  (P.foldl1 (\a b -> (unpack a) P.++ "&" P.++ (unpack b)) $ P.map (\(k,v) -> (unpack k) P.++ "=" P.++ (unpack v)) (extra p))
                 --let addedParam = appendIndex getParameters

                 returnJson $ nub $ P.map entityVal (logs :: [Entity LogDB])
