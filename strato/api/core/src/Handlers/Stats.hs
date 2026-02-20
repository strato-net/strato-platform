{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}

module Handlers.Stats
  ( API,
    server,
    TransactionCount(..)
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Control.Lens.Operators ((&), (.~), (?~))
import Control.Monad.Change.Modify
import Control.Monad.Composable.SQL
import Data.Aeson
import Data.OpenApi hiding (server)
import qualified Database.Esqueleto.Legacy as E
import Servant
import UnliftIO

newtype TotalDifficulty = TotalDifficulty Integer

instance ToJSON TotalDifficulty where
  toJSON (TotalDifficulty td) = object ["difficulty" .= td]

instance FromJSON TotalDifficulty where
  parseJSON (Object o) = TotalDifficulty <$> o .: "difficulty"
  parseJSON e = fail $ "FromJSON TotalDifficulty: Expected object, got " ++ show e

instance ToSchema TotalDifficulty where
  declareNamedSchema _ = do
    intSchema <- declareSchemaRef (Proxy :: Proxy Integer)
    return $ NamedSchema (Just "TotalDifficulty") $ mempty
      & type_ ?~ OpenApiObject
      & properties .~ [("difficulty", intSchema)]
      & required .~ ["difficulty"]

newtype TransactionCount = TransactionCount Integer

instance ToJSON TransactionCount where
  toJSON (TransactionCount td) = object ["transactionCount" .= td]

instance FromJSON TransactionCount where
  parseJSON (Object o) = TransactionCount <$> o .: "transactionCount"
  parseJSON e = fail $ "FromJSON TransactionCount: Expected object, got " ++ show e

instance ToSchema TransactionCount where
  declareNamedSchema _ = do
    intSchema <- declareSchemaRef (Proxy :: Proxy Integer)
    return $ NamedSchema (Just "TransactionCount") $ mempty
      & type_ ?~ OpenApiObject
      & properties .~ [("transactionCount", intSchema)]
      & required .~ ["transactionCount"]

type API =
  "stats" :> "totaltx" :> Get '[JSON] TransactionCount

server :: Accessible TransactionCount m => ServerT API m
server = getStatTx

---------------------

instance {-# OVERLAPPING #-} MonadUnliftIO m => Accessible TransactionCount (SQLM m) where
  access _ = do
    tx <- sqlQuery $ E.select $ E.from $ \(_ :: E.SqlExpr (E.Entity RawTransaction)) -> return E.countRows
    return . TransactionCount $ myval (tx :: [E.Value Integer])
    where
      myval ((E.Value v) : _) = v
      myval _ = 0

getStatTx :: Accessible TransactionCount m => m TransactionCount
getStatTx = access (Proxy @TransactionCount)
