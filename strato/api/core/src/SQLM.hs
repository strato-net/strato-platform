{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

{-# OPTIONS -fno-warn-orphans #-}

module SQLM where

import BlockApps.Logging
import qualified Data.Aeson as JSON
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.HashMap.Lazy as HashMap
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Stack
import Network.HTTP.Types.Status
import Servant hiding (ServerError)
import qualified Servant as SERVANT (ServerError)
import Servant.Client
import Text.Printf
import UnliftIO

data ApiError
  = NoFilterError String
  | MissingParameterError String
  | InvalidArgs String
  | ServerError String
  | NamedChainError Text
  | AmbiguousChainError Text
  | DeprecatedError String
  | StratoError ClientError
  | CirrusError SERVANT.ServerError
  | VaultWrapperError ClientError
  | IdentitytWrapperError ClientError
  | DBError Text
  | UserError Text
  | TxSizeError Text
  | NonceLimitExceededError
  | CouldNotFind Text
  | AnError Text
  | Unimplemented Text
  | AlreadyExists Text
  | RuntimeError SomeException
  | UnavailableError Text
  | InternalError Text
  | NotYetSynced Integer Integer
  | VMError Text
  | Timeout Text
  deriving (Show, Exception)

apiErrorToServantErr :: ApiError -> SERVANT.ServerError
apiErrorToServantErr = \case
  NoFilterError str -> err400 {errBody = BLC.pack str}
  MissingParameterError str -> err400 {errBody = BLC.pack str}
  InvalidArgs str -> err400 {errBody = BLC.pack str}
  ServerError str -> err500 {errBody = BLC.pack str}
  NamedChainError t -> err400 {errBody = BLC.pack $ T.unpack t}
  AmbiguousChainError t -> err400 {errBody = BLC.pack $ T.unpack t}
  DeprecatedError str -> err400 {errBody = BLC.pack str}
  StratoError (FailureResponse _ Response {..})
    | responseStatusCode == status404 ->
      err404
        { errBody =
            JSON.encode $
              unlines
                [ "Strato Error!",
                  "Bloc seems to be improperly configured: Strato page is missing.",
                  "Please contact your network administrator to have this problem fixed.",
                  "(More information can be found in the strato-api logs.)",
                  "Error Message:",
                  compensateForTheOddStratoApiFormattingAndPullOutTheMessage responseBody
                ]
        }
    | statusIsClientError responseStatusCode ->
      err400 {errBody = JSON.encode $ compensateForTheOddStratoApiFormattingAndPullOutTheMessage responseBody}
  StratoError (ConnectionError _) ->
    err500
      { errBody =
          JSON.encode $
            unlines
              [ "Strato Error!",
                "Bloc can not connect to Strato.",
                "This probably is a configuration error, but can also mean the Strato peer is down.",
                "Please contact your network administrator to have this problem fixed.",
                "(More information can be found in the strato-api logs.)"
              ]
      }
  StratoError _ ->
    err500
      { errBody =
          JSON.encode $
            unlines
              [ "Strato Error!",
                "Bloc recieved a malformed response from Strato.",
                "This is probably a backend configuration problem.",
                "Please contact your network administrator to have this problem fixed.",
                "(More information can be found in the strato-api logs.)"
              ]
      }
  VaultWrapperError (FailureResponse _ Response {..})
    | responseStatusCode == status503 ->
      err503 {errBody = responseBody}
    | statusIsClientError responseStatusCode ->
      err400 {errBody = responseBody}
  VaultWrapperError (ConnectionError _) ->
    err500
      { errBody =
          JSON.encode $
            unlines
              [ "Connection Error!",
                "Bloc can not connect to the Vault Wrapper.",
                "This probably is a configuration error, but can also mean the Strato peer is down.",
                "Please contact your network administrator to have this problem fixed.",
                "(More information can be found in the strato-api logs.)"
              ]
      }
  IdentitytWrapperError _ ->
    err500
      { errBody =
          JSON.encode $
            unlines
              [ "Identity Server Error!",
                "Please contact your network administrator to have this problem fixed.",
                "(More information can be found in the identity server logs.)"
              ]
      }
  VaultWrapperError _ ->
    err500
      { errBody =
          JSON.encode $
            unlines
              [ "Vault-Wrapper Error!",
                "Bloc recieved a malformed response from Vault-Wrapper.",
                "This is probably a backend configuration problem.",
                "Please contact your network administrator to have this problem fixed.",
                "(More information can be found in the strato-api logs.)"
              ]
      }
  DBError _ ->
    err500
      { errBody =
          JSON.encode $
            unlines
              [ "Database Error!",
                "Something is broken in the Bloc Server database.",
                "Please contact your network administrator to have this problem fixed.",
                "(More information can be found in the strato-api logs.)"
              ]
      }
  CirrusError err -> err500 {errBody = JSON.encode (show err)}
  UserError err -> err400 {errBody = JSON.encode err}
  TxSizeError err ->
    err400
      { errBody =
          JSON.encode $
            unlines
              [ "Transaction size too large!",
                T.unpack err
              ]
      }
  NonceLimitExceededError -> err400 {errBody = JSON.encode $ unlines ["You have reached your transaction limit."]}
  AlreadyExists err -> err409 {errBody = JSON.encode err}
  CouldNotFind err -> err400 {errBody = JSON.encode err}
  UnavailableError err -> err503 {errBody = JSON.encode err}
  AnError _ ->
    err500
      { errBody =
          JSON.encode $
            unlines
              [ "Internal Error!",
                "Something is broken in the Bloc Server.",
                "Please contact your network administrator to have this problem fixed.",
                "(More information can be found in the strato-api logs.)"
              ]
      }
  Unimplemented err ->
    err501
      { errBody =
          JSON.encode $
            unlines
              [ "Unimplemented Error",
                "You are using a feature of the Bloc Server that has not yet been implemented.",
                T.unpack err
              ]
      }
  RuntimeError _ ->
    err500
      { errBody =
          JSON.encode $
            unlines
              [ "Runtime Error!",
                "Something wrong has happened inside of bloc.",
                "Please contact your network administrator to have this problem fixed.",
                "(More information can be found in the strato-api logs.)"
              ]
      }
  InternalError err ->
    err500
      { errBody =
          JSON.encode $
            unlines
              [ "Internal Error!",
                "Bloc couldn't process that request.",
                "Please contact your network administrator.",
                "Error Message:",
                T.unpack err
              ]
      }
  NotYetSynced n d ->
    err503
      { errBody =
          JSON.encode $
            unlines
              [ "Not Yet Synced!",
                "Transactions cannot be posted to this node until it has synced with the network.",
                "Please wait or use another node.",
                concat ["Total Difficulty: ", show n, " / ", show d]
              ]
      }
  VMError err -> err422 {errBody = JSON.encode err}
  Timeout err -> err504 {errBody = JSON.encode err}

--This is an annoyingly named and poorly written function, deliberately designed that way to remind us that we need to clean up the response from strato-api/solc.
compensateForTheOddStratoApiFormattingAndPullOutTheMessage :: BLC.ByteString -> String
compensateForTheOddStratoApiFormattingAndPullOutTheMessage x | "Invalid Arguments" `BLC.isPrefixOf` x =
  case JSON.decode $ BLC.drop 18 x of
    Nothing -> show x
    Just o -> fromMaybe (show x) (HashMap.lookup ("error" :: Text) o)
compensateForTheOddStratoApiFormattingAndPullOutTheMessage x = show x

blocError :: (HasCallStack, MonadIO m, MonadLogger m) => ApiError -> m y
blocError err = do
  logErrorCS callStack . T.pack $
    printf "err: %s\nCallstack:%s" (show err) (prettyCallStack callStack)
  throwIO err

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
