{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

{-# OPTIONS -fno-warn-orphans #-}

module SQLM where

import           Blockchain.DB.SQLDB
import           Blockchain.Output
import qualified Control.Monad.Change.Modify as Mod
import           Control.Monad.Trans.Reader
import qualified Data.ByteString.Lazy.Char8  as BLC
import qualified Data.Text                   as T
import           Database.Persist.Sql
import           Servant                     hiding (ServerError)
import qualified Servant                     as SERVANT (ServerError)
import           UnliftIO

import           Control.Monad.Composable.SQL hiding (SQLM)

type SQLM = ReaderT SQLDB (LoggingT IO)

instance Mod.Accessible SQLDB SQLM where
  access _ = ask

instance HasSQL SQLM where
  getSQLPool = fmap unSQLDB ask

runSQLM :: ConnectionPool -> SQLM a -> IO a
runSQLM pool = runLoggingT . flip runReaderT (SQLDB pool)

data ApiError
  = NoFilterError String
  | MissingParameterError String
  | InvalidArgs String
  | ServerError String
  | NamedChainError T.Text
  | AmbiguousChainError T.Text
  | DeprecatedError String
  | RuntimeError SomeException
  deriving (Show, Exception)

apiErrorToServantErr :: ApiError -> SERVANT.ServerError
apiErrorToServantErr = \case
  NoFilterError str -> err400{ errBody = BLC.pack str }
  MissingParameterError str -> err400{ errBody = BLC.pack str }
  InvalidArgs str -> err400{ errBody = BLC.pack str }
  ServerError str -> err500 { errBody = BLC.pack str }
  NamedChainError t -> err400{errBody = BLC.pack $ T.unpack t }
  AmbiguousChainError t -> err400{ errBody = BLC.pack $ T.unpack t }
  DeprecatedError str -> err400 { errBody = BLC.pack str }
  RuntimeError e -> err500 { errBody = BLC.pack $ "Runtime exception: " ++ show e }

handleRuntimeError :: SomeException -> SQLM a
handleRuntimeError (e :: SomeException) = case fromException e of
  Just (_ :: ApiError) -> throwIO e
  Nothing -> throwIO $ RuntimeError e

handleApiError :: ApiError -> SQLM a
handleApiError = \case
  e@(RuntimeError _) -> do
    $logErrorS "handleApiError/RuntimeError" . T.pack $
      show e ++ "\n  callstack missing for runtime errors"
    throwIO e
  e -> do
    $logErrorS "handleApiError" . T.pack $ show e
    throwIO e

