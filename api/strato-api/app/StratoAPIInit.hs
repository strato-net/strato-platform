{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}

module Main where

import           Control.Monad
import           Database.PostgreSQL.Simple
import           HFlags

import qualified BlockApps.Bloc22.Database.Create        as Bloc22
import qualified BlockApps.Bloc22.Database.Migration     as Bloc22
import           Blockchain.Output
import           Control.Monad.Composable.BlocSQL
import           SelectAccessible                        ()

main :: IO ()
main = do
  _ <- $initHFlags "Core API"

  let dbConnectInfo = ConnectInfo { connectHost = "postgres"
                                 , connectPort = 5432
                                 , connectUser = "postgres"
                                 , connectPassword = "api"
                                 , connectDatabase = ""
                                 }
  dbCreateConn <- connect dbConnectInfo

  doesNotExist22 <- null <$>
    (query_ dbCreateConn dbExistsQuery22 :: IO [Only Int])
  when doesNotExist22 $ void $ execute_ dbCreateConn Bloc22.createDatabase

  close dbCreateConn

  runLoggingT .
    runBlocSQLM "postgres" 5432 "postgres" "api" $
    Bloc22.runBlocMigrations

  return ()

dbExistsQuery22 :: Query
dbExistsQuery22 = "SELECT 1 FROM pg_database WHERE datname='bloc22';"

