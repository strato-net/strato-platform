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

import Aws (Credentials(..))
import Data.ByteString.Lazy as DBL hiding (map)
import BlockApps.Logging as BL
import Control.Monad.Reader
import Control.Monad.Trans.Except
import Data.String
import Data.Text (Text)
import qualified Data.Text as Text
import GHC.Stack
import Network.HTTP.Client
import Network.Wai.Parse
import Servant
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
  { httpManager        :: Manager
  , awsCredentials     :: Credentials 
  , generatedBoundary  :: DBL.ByteString
  , awss3bucket        :: Text
  , highwayUrl         :: Text
  }

data HighwayWrapperError
  = BadGetError 
  | BadPostError
  | UserError Text
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
handleRuntimeError (e :: SomeException) =
  case fromException e of
    Just (_ :: HighwayWrapperError) -> throwIO e
    Nothing -> throwIO $ RuntimeError e

handleHighwayError :: HighwayWrapperError -> HighwayM a
handleHighwayError = \case
  BadGetError -> do
    $logErrorS
      "handleHighwayError/BadGetError"
      "Could not retrieve file from S3."
    throwIO BadGetError
  BadPostError -> do
    $logErrorS
      "handleHighwayError/BadPostError"
      "Could not push file contents to S3."
    throwIO BadPostError
  e@(RuntimeError _) -> do
    $logErrorS "handleHighwayError/RuntimeError" . Text.pack $
      show e ++ "\n  callstack missing for runtime errors"
    throwIO e
  e -> do
    $logErrorLS "handleHighwayError" e
    throwIO e

enterHighwayWrapper :: HighwayWrapperEnv -> HighwayM x -> Handler x
enterHighwayWrapper env x = Handler $ do
  eRes <- liftIO . runHighwayToIO env $ x                  `catch`
                                        handleRuntimeError `catch`
                                        handleHighwayError
  case eRes of
    Right a -> return a
    Left e -> throwE $ reThrowError e
  where
    reThrowError :: HighwayWrapperError -> ServerError
    reThrowError =
      \case
        BadGetError ->
          err404
            { errBody =
                fromString $
                  unlines
                    [ "Bad GET Error!",
                      "Could not find file."
                    ]
            }
        BadPostError ->
          err500
            { errBody =
                fromString $
                  unlines
                    [ "Bad POST Error!",
                      "Upload of file was unsuccessful."
                    ]
            }
        UserError err ->
          err500
            { errBody =
                fromString $
                  unlines
                    [ "User Error!",
                      "Error Message:",
                      Text.unpack err
                    ]
            }
        RuntimeError e ->
          case fromException e of
            Just (pe :: RequestParseException) ->
              err400
                { errBody =
                    fromString $
                      show pe
                }
            Nothing                            ->
              err500
                { errBody =
                    fromString $
                      unlines
                        [ "Runtime Error!",
                          "Something wrong has happened inside of STRATO.",
                          "Please contact your network administrator to have this problem fixed."
                        ]
                }
