{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE ImplicitParams #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeFamilies #-}

module Strato.Monad where

import BlockApps.Logging
import Control.Monad.Reader
import Control.Monad.Trans.Except
import qualified Crypto.Saltine.Core.SecretBox as SecretBox
import qualified Data.ByteString.Lazy as LB
import Data.Cache
import Data.Foldable
import Data.Pool (Pool, withResource)
import Data.Profunctor.Product.Default
import Data.String
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Text.Encoding
import Database.PostgreSQL.Simple (Connection, withTransaction)
import GHC.Stack
import Network.HTTP.Client
import Opaleye
import Opaleye.Internal.QueryArr
import Servant
import Strato.Strato23.Crypto
import UnliftIO hiding (Handler (..))

type HighwayM = ReaderT HighwayWrapperEnv (LoggingT IO)

toUserError :: (MonadUnliftIO m, MonadLogger m) => Text -> m a -> m a
toUserError msg = flip catch $ reportAndConvertError msg
  where
    reportAndConvertError ::
      (MonadIO m, MonadLogger m) =>
      Text ->
      SomeException ->
      m a
    reportAndConvertError msg' e = do
      $logErrorS "toUserError" $ Text.pack $ "Internal Error: " ++ show e
      throwIO $ UserError msg'

--prettyCallStack' is the same idea as prettyCallStack, but with formatting more suitable for out project.  In particular, package names a very mangled by stack, making prettyCallStack unreadable.
prettyCallStack' :: CallStack -> String
prettyCallStack' cs =
  "CallStack:\n" ++ unlines (map formatCSLine $ getCallStack cs)
  where
    formatCSLine (funcName, SrcLoc {..}) =
      "  " ++ funcName ++ ", called at " ++ srcLocModule ++ ":" ++ show srcLocStartLine ++ ":" ++ show srcLocStartCol

highwayWrapperError :: HasCallStack => HighwayWrapperError -> HighwayM y
highwayWrapperError err = do
  logErrorCS callStack . Text.pack $ show err ++ "\n" ++ prettyCallStack' ?callStack
  throwIO err

data HighwayWrapperEnv = HighwayWrapperEnv
  { httpManager :: Manager
  }

data HighwayWrapperError
  =
  | BadPutError 
  | BadGetError
  | RuntimeError SomeException
  deriving (Show, Exception)

--------------------------------------------------------------------------------

runHighwayWithEnv :: HighwayWrapperEnv -> HighwayM a -> IO a
runHighwayWithEnv env =
  runLoggingT
    . flip runReaderT env

runHighwayToIO :: HighwayWrapperEnv -> HighwayM a -> IO (Either HighwayWrapperError a)
runHighwayToIO env = try . runHighwayWithEnv env

handleRuntimeError :: SomeException -> HighwayM a
handleRuntimeError (e :: SomeException) = case fromException e of
  Just (_ :: HighwayWrapperError) -> throwIO e
  Nothing -> throwIO $ RuntimeError e

handleHighwayError :: HighwayWrapperError -> HighwayM a
handleHighwayError = \case
  BadGetError -> do
    $logErrorS
      "handleHighwayError/BadGetError"
      "Could not retrieve file from S3."
    throwIO BadGetError
  BadPutError -> do
    $logErrorS
      "handleHighwayError/BadPutError"
      "Could not push file contents to S3."
    throwIO IncorrectPasswordError
  e@(RuntimeError _) -> do
    $logErrorS "handleHighwayError/RuntimeError" . Text.pack $
      show e ++ "\n  callstack missing for runtime errors"
    throwIO e
  e -> do
    $logErrorLS "handleHighwayError" e
    throwIO e

enterHighwayWrapper :: HighwayWrapperEnv -> HighwayM x -> Handler x
enterHighwayWrapper env x = Handler $ do
  eRes <- liftIO . runHighwayToIO env $ x `catch` handleRuntimeError `catch` handleHighwayError
  case eRes of
    Right a -> return a
    Left e -> throwE $ reThrowError e
  where
    reThrowError :: VaultHighwayError -> ServerError
    reThrowError =
      \case
        BadGetError err ->
          err404
            { errBody =
                fromString $
                  unlines
                    [ "Bad GET Error!",
                      "Could not find file.",
                      "Error Message:",
                      Text.unpack err
                    ]
            }
        BadPutError err ->
          err500
            { errBody =
                fromString $
                  unlines
                    [ "Bad PUT Error!",
                      "Upload of file was unsuccessful.",
                      "Error Message:",
                      Text.unpack err
                    ]
            }
        RuntimeError _ ->
          err500
            { errBody =
                fromString $
                  unlines
                    [ "Runtime Error!",
                      "Something wrong has happened inside of STRATO.",
                      "Please contact your network administrator to have this problem fixed."
                    ]
            }
