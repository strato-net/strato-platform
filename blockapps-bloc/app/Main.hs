{-# LANGUAGE
    OverloadedStrings
#-}

module Main where

import Hasql.Connection
import Network.HTTP.Client
import Network.Wai.Handler.Warp

import BlockApps.Bloc.API
import BlockApps.Bloc.Monad
import BlockApps.Strato.API.Client

main :: IO ()
main = do
  connEither <- acquire "connection-string"
  case connEither of
    Left err -> print err
    Right conn -> do
      mgr <- newManager defaultManagerSettings
      let blocEnv = BlocEnv stratoDev mgr conn
      run 8000 (appBloc blocEnv)
