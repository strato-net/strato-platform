{-# LANGUAGE OverloadedStrings, ForeignFunctionInterface #-}
{-# LANGUAGE EmptyDataDecls             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE FlexibleInstances           #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}
{-# LANGUAGE DeriveGeneric              #-}
{-# OPTIONS_GHC -fno-warn-unused-binds #-} 
    
module Blockchain.Data.Blockchain
    ( 
      createDB, migrateDB, insertBlockchain
    ) where

import qualified Blockchain.Colors as CL

import Database.Persist
import Database.Persist.TH
import Database.Persist.Postgresql hiding (get)

import Control.Monad.Logger (runNoLoggingT)
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Control
import Control.Monad.IO.Class

import qualified Data.Text as T

{- global registry of blockchains -}

share [mkPersist sqlSettings, mkMigrate "migrateAll"] [persistLowerCase|
Blockchain
    path String
    uuid String
    deriving Show
|]

createDB :: ConnectionString -> IO ()
createDB pgConn = do
    putStrLn $ CL.yellow ">>>> Creating global database"
    let create = T.pack $ "CREATE DATABASE blockchain;"
    runNoLoggingT $ withPostgresqlConn pgConn $ runReaderT $ rawExecute create []

migrateDB :: (MonadBaseControl IO m, MonadIO m) => ConnectionString -> m ()
migrateDB pgConn = runNoLoggingT $ withPostgresqlConn pgConn $ runReaderT $ runMigration migrateAll

insertBlockchain ::  (MonadBaseControl IO m, MonadIO m) => ConnectionString -> String -> String -> m (Key Blockchain)
insertBlockchain pgConn path uuid = runNoLoggingT $ withPostgresqlConn pgConn $ runReaderT $ do
      insert $ Blockchain { 
                 blockchainPath = path,
                 blockchainUuid = uuid
             }      
