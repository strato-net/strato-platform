{-# LANGUAGE DeriveGeneric       #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE QuasiQuotes         #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeFamilies        #-}

module Handler.Stats where

import           Import

import qualified Database.Esqueleto as E
import           Handler.Common

import Blockchain.DB.DetailsDB

data Stats = Stats
    { name    :: Text
    , version :: Int
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
  bestBlock <- getBestBlock
  return $ object ["difficulty" .= blockDataRefTotalDifficulty bestBlock]

getStatTxR :: Handler Value
getStatTxR  = do
                   addHeader "Access-Control-Allow-Origin" "*"
                   tx <- runDB $ E.select $ E.from $ \(_ :: E.SqlExpr (Entity RawTransaction)) -> return E.countRows
                   return $ myval (tx :: [E.Value Integer])
            where
              myval ((E.Value v):_) = object ["transactionCount" .= (v :: Integer)]
              myval _               = object ["transactionCount" .= ("0" :: String)]
