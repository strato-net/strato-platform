{-# LANGUAGE
    OverloadedStrings
  , TemplateHaskell
#-}

module Main where

import Control.Exception
import Data.String
import Hasql.Connection
import qualified Hasql.Session as Session
import Hasql.Query
import Hasql.Decoders
import HFlags
import Network.HTTP.Client
import Network.Wai.Handler.Warp

import BlockApps.Bloc.API
import BlockApps.Bloc.Monad
import BlockApps.Strato.Client
import BlockApps.Bloc.Database
import BlockApps.Bloc.Options

handleErr::Exception e=>
           (a->e)->Either a b->b
handleErr typeF (Left e) = throw $ typeF e
handleErr _ (Right x) = x

--TODO: refactor
main :: IO ()
main = do
  _ <- $initHFlags "Setup EthereumH DBs"

  dbCreateConn <- fmap (handleErr DBConnectionError) $
                  acquire $ settings "localhost" 5432 "postgres" (fromString flags_password) "postgres"

  let
        queryString' = "SELECT 1 FROM pg_database WHERE datname='bloc';"
        params = mempty
        results = maybeRow (value int8)
        query = statement queryString' params results False
        
  session <- fmap (handleErr DBError) $
             Session.run (Session.query () query) dbCreateConn

  case session of
   Nothing -> 
     fmap (handleErr DBError) $
       Session.run (Session.sql "CREATE DATABASE bloc;") dbCreateConn
   Just 1 -> return ()
   Just _ -> putStrLn "Unexpected result from db exists check"
   
  release dbCreateConn
  
  conn <- fmap (handleErr DBConnectionError) $
          acquire $ settings "localhost" 5432 "postgres" (fromString flags_password) "bloc"

  -- TODO: database connection resource management

  fmap (handleErr DBError) $
    Session.run (Session.sql createTables) conn

  mgr' <- newManager defaultManagerSettings
  let blocEnv = BlocEnv stratoDev mgr' conn
  run 8000 (appBloc blocEnv)
