{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE EmptyDataDecls #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE Rank2Types #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE NoDeriveAnyClass #-}
{-# OPTIONS_GHC -fno-warn-name-shadowing #-}
{-# OPTIONS_GHC -fno-warn-unused-binds #-}

module Blockchain.Data.Blockchain
  ( createDB,
    migrateDB,
    insertBlockchain,
    migrateAll,
  )
where

import BlockApps.Logging (LoggingT, runNoLoggingT)
import Blockchain.DB.SQLDB (runPostgresConn)
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Reader
import Database.Persist
import Database.Persist.Postgresql hiding (get)
import Database.Persist.TH
import qualified Text.Colors as CL

{- global registry of blockchains -}

share
  [mkPersist sqlSettings, mkMigrate "migrateAll"]
  [persistLowerCase|
Blockchain
    path String
    uuid String
    deriving Show
|]

-- instance (IsSqlBackend t) => BaseBackend t ~ SqlBackend

createDB :: ConnectionString -> IO ()
createDB pgConn = do
  putStrLn $ CL.yellow ">>>> Creating global database"
  let create = "CREATE DATABASE blockchain;"
  runNoLoggingT $ withPostgresqlConn pgConn (runReaderT (rawExecute create []) :: SqlBackend -> LoggingT IO ())

migrateDB :: MonadUnliftIO m => ConnectionString -> m ()
migrateDB pgConn = runNoLoggingT . runPostgresConn pgConn $ runMigration migrateAll

insertBlockchain :: MonadUnliftIO m => ConnectionString -> String -> String -> m (Key Blockchain)
insertBlockchain pgConn path uuid =
  runNoLoggingT . runPostgresConn pgConn $
    insert Blockchain {blockchainPath = path, blockchainUuid = uuid}
