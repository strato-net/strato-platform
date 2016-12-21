{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Handler.Stats where

import Import

import Handler.Common
import qualified Database.Esqueleto as E

data Stats = Stats
    { name :: Text
    , version  :: Int
    , genesis :: String
    } deriving Generic

instance ToJSON Stats

getStatsR :: Handler TypedContent
getStatsR = selectRep $ do
    provideRep $
      defaultLayout $ do
        setTitle "BlockApps.net - statistics"
        $(widgetFile "stats")
    provideJson stats
  where
    stats@Stats {..} = Stats "Strato" 1 "genesis"

getStatDiffR :: Handler Value
getStatDiffR  = do 
                   addHeader "Access-Control-Allow-Origin" "*"
                   blks <- runDB $ E.select $
                        E.from $ \(a, t) -> do
                        E.where_ (  a E.^. BlockDataRefBlockId E.==. t E.^. BlockId)
                        let sum' = E.sum_ (a E.^. BlockDataRefDifficulty)
                        -- E.limit $ P.min (fromIntegral n :: Int64) fetchLimit 
                        -- E.orderBy [E.desc (a E.^. BlockDataRefNumber)]
                        return sum'
                   return $ myval (blks :: [E.Value (Maybe Integer)]) 
            where
              myval ((E.Value (Just v)):_) = object ["difficulty" .= (v :: Integer)]
              myval _                       = object ["difficulty" .= ("0" :: String)]

getStatTxR :: Handler Value
getStatTxR  = do 
                   addHeader "Access-Control-Allow-Origin" "*"
                   tx <- runDB $ E.select $ E.from $ \(_ :: E.SqlExpr (Entity RawTransaction)) -> return E.countRows
                   return $ myval (tx :: [E.Value Integer]) 
            where
              myval ((E.Value v):_) = object ["transactionCount" .= (v :: Integer)]
              myval _                       = object ["transactionCount" .= ("0" :: String)]
