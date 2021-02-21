{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}

module Handlers.Stats (
  API,
  server
  ) where

import           Control.Monad.Change.Modify
import           Data.Aeson
import           Data.Swagger
import qualified Database.Esqueleto            as E
import           Servant

import           Blockchain.Data.DataDefs
import           Blockchain.DB.DetailsDB
import           Blockchain.DB.SQLDB

import           Control.Monad.Composable.SQL

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

server :: HasSQL m => ServerT API m
server = getStatTx :<|> getStatDiff

---------------------

instance HasSQL m => Accessible TotalDifficulty m where
  access _ = TotalDifficulty . blockDataRefTotalDifficulty <$> getBestBlock

instance HasSQL m => Accessible TransactionCount m where
  access _ = do
    tx <- sqlQuery $ E.select $ E.from $ \(_ :: E.SqlExpr (E.Entity RawTransaction)) -> return E.countRows
    return .TransactionCount $ myval (tx :: [E.Value Integer])
    where
      myval ((E.Value v):_) = v
      myval _               = 0

getStatDiff :: Accessible TotalDifficulty m => m TotalDifficulty
getStatDiff = access (Proxy @TotalDifficulty)

getStatTx :: Accessible TransactionCount m => m TransactionCount
getStatTx = access (Proxy @TransactionCount)
