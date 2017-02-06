{-# LANGUAGE
    OverloadedStrings
#-}

module Main where

import Hasql.Connection
import qualified Hasql.Session as Session
import Network.HTTP.Client
import Network.Wai.Handler.Warp

import BlockApps.Bloc.API
import BlockApps.Bloc.Monad
import BlockApps.Strato.API.Client
import BlockApps.Bloc.Database

main :: IO ()
main = do
  connEither <- acquire $ settings "localhost" 5432 "postgres" "" "bloc"
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
