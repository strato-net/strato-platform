{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE EmptyDataDecls             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE Rank2Types                 #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}
{-# OPTIONS_GHC -fno-warn-unused-binds  #-}

module Blockchain.Data.Blockchain
    (
      createDB, migrateDB, insertBlockchain, migrateAll
    ) where

import qualified Blockchain.Colors           as CL

import           Database.Persist
import           Database.Persist.Postgresql hiding (get)
import           Database.Persist.TH

import           Control.Monad.IO.Class
import           Control.Monad.Logger        (runNoLoggingT)
import           Control.Monad.Trans.Control
import           Control.Monad.Trans.Reader

import           Blockchain.DB.SQLDB         (runPostgresConn)

{- global registry of blockchains -}

share [mkPersist sqlSettings, mkMigrate "migrateAll"] [persistLowerCase|
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
    runNoLoggingT $ withPostgresqlConn pgConn $ runReaderT $ rawExecute create []

migrateDB :: (MonadBaseControl IO m, MonadIO m) => ConnectionString -> m ()
migrateDB pgConn = runNoLoggingT . runPostgresConn pgConn $ runMigration migrateAll

insertBlockchain :: (MonadBaseControl IO m, MonadIO m) => ConnectionString -> String -> String -> m (Key Blockchain)
insertBlockchain pgConn path uuid = runNoLoggingT . runPostgresConn pgConn $
    insert Blockchain { blockchainPath = path, blockchainUuid = uuid }
