{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Stats (
  API,
  server
  ) where

import           Control.Monad.FT
import           Data.Aeson
import           Data.Swagger                  hiding (get)
import qualified Database.Esqueleto            as E
import           Servant

import           Blockchain.Data.DataDefs
import           Blockchain.DB.DetailsDB
import           Blockchain.DB.SQLDB

import           SQLM

newtype TotalDifficulty = TotalDifficulty Integer

instance ToJSON TotalDifficulty where
  toJSON (TotalDifficulty td) = object ["difficulty" .= td]

instance FromJSON TotalDifficulty where
  parseJSON (Object o) = TotalDifficulty <$> o .: "difficulty"
  parseJSON e          = fail $ "FromJSON TotalDifficulty: Expected object, got " ++ show e

instance ToSchema TotalDifficulty where
  declareNamedSchema _ = return $
    NamedSchema (Just "TotalDifficulty") mempty

newtype TransactionCount = TransactionCount Integer

instance ToJSON TransactionCount where
  toJSON (TransactionCount td) = object ["transactionCount" .= td]

instance FromJSON TransactionCount where
  parseJSON (Object o) = TransactionCount <$> o .: "transactionCount"
  parseJSON e          = fail $ "FromJSON TransactionCount: Expected object, got " ++ show e

instance ToSchema TransactionCount where
  declareNamedSchema _ = return $
    NamedSchema (Just "TransactionCount") mempty

type API =
  "stats" :> "totaltx" :> Get '[JSON] TransactionCount
  :<|> "stats" :> "difficulty" :> Get '[JSON] TotalDifficulty

server :: ServerT API SQLM
server = getStatTx :<|> getStatDiff

---------------------

instance Gettable TotalDifficulty SQLM where
  get = TotalDifficulty . blockDataRefTotalDifficulty <$> getBestBlock

instance Gettable TransactionCount SQLM where
  get = do
    tx <- sqlQuery $ E.select $ E.from $ \(_ :: E.SqlExpr (E.Entity RawTransaction)) -> return E.countRows
    return .TransactionCount $ myval (tx :: [E.Value Integer])
    where
      myval ((E.Value v):_) = v
      myval _               = 0

getStatDiff :: Gettable TotalDifficulty m => m TotalDifficulty
getStatDiff = get

getStatTx :: Gettable TransactionCount m => m TransactionCount
getStatTx = get