{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

{-# OPTIONS -fno-warn-orphans #-}

module SQLM where

import           Blockchain.Output
import qualified Data.ByteString.Lazy.Char8  as BLC
import qualified Data.Text                   as T
import           Servant                     hiding (ServerError)
import qualified Servant                     as SERVANT (ServerError)
import           UnliftIO

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

handleRuntimeError :: MonadIO m => SomeException -> m a
handleRuntimeError (e :: SomeException) = case fromException e of
  Just (_ :: ApiError) -> throwIO e
  Nothing -> throwIO $ RuntimeError e

handleApiError :: (MonadIO m, MonadLogger m) => ApiError -> m a
handleApiError = \case
  e@(RuntimeError _) -> do
    $logErrorS "handleApiError/RuntimeError" . T.pack $
      show e ++ "\n  callstack missing for runtime errors"
    throwIO e
  e -> do
    $logErrorS "handleApiError" . T.pack $ show e
    throwIO e

