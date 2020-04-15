{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Stats (
  API,
  server
  ) where

import           Control.Monad.IO.Class
import           Data.Aeson
import           Data.Text                     (Text)
import qualified Database.Esqueleto            as E
import           Database.Persist.Postgresql
import           GHC.Generics
import           Servant

import           Blockchain.Data.DataDefs
import           Blockchain.DB.DetailsDB
import           Blockchain.DB.SQLDB

import           SQLM


type API =
  "stats" :> "totaltx" :> Get '[JSON] Value
  :<|> "stats" :> "difficulty" :> Get '[JSON] Value

server :: ConnectionString -> Server API
server connectionString = getStatTx connectionString :<|> getStatDiff connectionString

---------------------

data Stats = Stats
    { name    :: Text
    , version :: Int
    , genesis :: String
    } deriving Generic

instance ToJSON Stats


getStatDiff :: ConnectionString -> Handler Value
getStatDiff connectionString = liftIO $ runSQLM connectionString $ do
  bestBlock <- getBestBlock
  return $ object ["difficulty" .= blockDataRefTotalDifficulty bestBlock]


getStatTx :: ConnectionString -> Handler Value
getStatTx connectionString = liftIO $ runSQLM connectionString $ do
  tx <- sqlQuery $ E.select $ E.from $ \(_ :: E.SqlExpr (E.Entity RawTransaction)) -> return E.countRows
  return $ myval (tx :: [E.Value Integer])
    where
      myval ((E.Value v):_) = object ["transactionCount" .= (v :: Integer)]
      myval _               = object ["transactionCount" .= ("0" :: String)]
