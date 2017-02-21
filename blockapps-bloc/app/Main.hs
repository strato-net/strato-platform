{-# LANGUAGE
    OverloadedStrings
#-}

module Main where

import Hasql.Connection
import qualified Hasql.Session as Session
import Hasql.Query
import Hasql.Decoders
import Network.HTTP.Client
import Network.Wai.Handler.Warp

import BlockApps.Bloc.API
import BlockApps.Bloc.Monad
import BlockApps.Strato.API.Client
import BlockApps.Bloc.Database

--TODO: refactor
main :: IO ()
main = do
  dbCreateConnEither <- acquire $ settings "localhost" 5432 "postgres" "" "postgres"
  case dbCreateConnEither of
    Left err -> print err
    Right dbCreateConn -> do
      let
        queryString = "SELECT 1 FROM pg_database WHERE datname='bloc';"
        params = mempty
        results = maybeRow (value int8)
        query = statement queryString params results False
      sessionEither <- Session.run (Session.query () query) dbCreateConn
      case sessionEither of
        Left err -> print err
        Right Nothing -> do
          resultEither <- Session.run (Session.sql "CREATE DATABASE bloc;") dbCreateConn
          case resultEither of
            Left err -> print err
            Right _ -> return ()
        Right (Just 1) -> return ()
        Right (Just _) -> putStrLn "Unexpected result from db exists check"
      release dbCreateConn
  connEither <- acquire $ settings "localhost" 5432 "postgres" "" "bloc"
  -- TODO: database connection resource management
  case connEither of
    Left err -> print err
    Right conn -> do
      sessionEither <- Session.run (Session.sql createTables) conn
      case sessionEither of
        Left err -> print err
        Right () -> do
          mgr <- newManager defaultManagerSettings
          let blocEnv = BlocEnv stratoDev mgr conn
          run 8000 (appBloc blocEnv)
