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

module Strato.Strato23.Monad where

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

type VaultM = ReaderT VaultWrapperEnv (LoggingT IO)

dbErrorToUserError :: MonadUnliftIO m => m a -> m a
dbErrorToUserError = flip catch $ \case
  DBError msg -> throwIO (UserError msg)
  err -> throwIO err

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

vaultWrapperError :: HasCallStack => VaultWrapperError -> VaultM y
vaultWrapperError err = do
  logErrorCS callStack . Text.pack $ show err ++ "\n" ++ prettyCallStack' ?callStack
  throwIO err

data VaultWrapperEnv = VaultWrapperEnv
  { httpManager :: Manager,
    dbPool :: Pool Connection,
    superSecretKey :: IORef (Maybe SecretBox.Key),
    keyStoreCache :: Cache Text KeyStore
  }

data VaultWrapperError
  = DBError Text
  | UserError Text
  | NoPasswordError
  | IncorrectPasswordError
  | CouldNotFind Text
  | AnError Text
  | Unimplemented Text
  | AlreadyExists Text
  | RuntimeError SomeException
  | UserDoesNotExist Text
  deriving (Show, Exception)

--------------------------------------------------------------------------------

runVaultWithEnv :: VaultWrapperEnv -> VaultM a -> IO a
runVaultWithEnv env =
  runLoggingT
    . flip runReaderT env

runVaultToIO :: VaultWrapperEnv -> VaultM a -> IO (Either VaultWrapperError a)
runVaultToIO env = try . runVaultWithEnv env

handleRuntimeError :: SomeException -> VaultM a
handleRuntimeError (e :: SomeException) = case fromException e of
  Just (_ :: VaultWrapperError) -> throwIO e
  Nothing -> throwIO $ RuntimeError e

handleVaultError :: VaultWrapperError -> VaultM a
handleVaultError = \case
  NoPasswordError -> do
    $logErrorS
      "handleVaultError/NoPasswordError"
      "Password has not been set. Please set password by calling POST /strato/v2.3/password for node to function properly"
    throwIO NoPasswordError
  IncorrectPasswordError -> do
    $logErrorS
      "handleVaultError/IncorrectPasswordError"
      "The password has been set incorrectly. Please restart the node and supply the correct password."
    throwIO IncorrectPasswordError
  e@(RuntimeError _) -> do
    $logErrorS "handleVaultError/RuntimeError" . Text.pack $
      show e ++ "\n  callstack missing for runtime errors"
    throwIO e
  e -> do
    $logErrorLS "handleVaultError" e
    throwIO e

enterVaultWrapper :: VaultWrapperEnv -> VaultM x -> Handler x
enterVaultWrapper env x = Handler $ do
  eRes <- liftIO . runVaultToIO env $ x `catch` handleRuntimeError `catch` handleVaultError
  case eRes of
    Right a -> return a
    Left e -> throwE $ reThrowError e
  where
    reThrowError :: VaultWrapperError -> ServerError
    reThrowError =
      \case
        DBError err ->
          err500
            { errBody =
                fromString $
                  unlines
                    [ "DB Error!",
                      "Something is broken in the STRATO database.",
                      "Please contact your network administrator to have this problem fixed.",
                      "Error Message:",
                      Text.unpack err
                    ]
            }
        UserError err -> err400 {errBody = fromString $ show err}
        UserDoesNotExist t -> err401 {errBody = LB.fromStrict $ encodeUtf8 t}
        NoPasswordError ->
          err503
            { errBody =
                fromString $
                  unlines
                    [ "No Password for Vault-Wrapper!",
                      "STRATO has not been initialized properly.",
                      "Please contact your network administrator to have this problem fixed."
                    ]
            }
        IncorrectPasswordError ->
          err503
            { errBody =
                fromString $
                  unlines
                    [ "Incorrect Password for Vault-Wrapper!",
                      "STRATO has not been initialized properly.",
                      "Please contact your network administrator to have this problem fixed."
                    ]
            }
        AlreadyExists err -> err409 {errBody = fromString $ show err}
        CouldNotFind err -> err404 {errBody = fromString $ show err}
        AnError err ->
          err500
            { errBody =
                fromString $
                  unlines
                    [ "An Error!",
                      "Something is broken in STRATO.",
                      "Please contact your network administrator to have this problem fixed.",
                      "Error Message:",
                      Text.unpack err
                    ]
            }
        Unimplemented err ->
          err501
            { errBody =
                fromString $
                  unlines
                    [ "Unimplemented Error!",
                      "You are using a feature that has not yet been implemented.",
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

withSecretKey :: (SecretBox.Key -> VaultM a) -> VaultM a
withSecretKey f = do
  pwioref <- asks superSecretKey
  key <- readIORef pwioref
  case key of
    Nothing -> vaultWrapperError NoPasswordError
    Just k -> f k

formatTopLocation :: [(String, SrcLoc)] -> String
formatTopLocation [] = "[-]"
formatTopLocation ((_, x) : _) = "[" ++ srcLocModule x ++ ":" ++ show (srcLocStartLine x) ++ "]"

vaultQuery ::
  (HasCallStack, Default Unpackspec x x, Default FromFields x y) =>
  Query x ->
  VaultM [y]
vaultQuery q = do
  traverse_ (logDebugCS callStack . Text.pack) (showSql q)
  pool <- asks dbPool
  liftIO $ withResource pool (\conn -> runSelect conn q)

vaultQueryMaybe ::
  (HasCallStack, Default Unpackspec x x, Default FromFields x y) =>
  Query x ->
  VaultM (Maybe y)
vaultQueryMaybe q =
  vaultQuery q >>= \case
    [] -> return Nothing
    [y] -> return (Just y)
    _ : _ : _ -> throwIO $ DBError "vaultQueryMaybe: Multiple results, expected one row"

vaultQuery1 ::
  (HasCallStack, Default Unpackspec x x, Default FromFields x y) =>
  Query x ->
  VaultM y
vaultQuery1 q =
  vaultQuery q >>= \case
    [] -> vaultWrapperError $ DBError "No result, expected one row"
    [y] -> return y
    _ : _ : _ -> throwIO $ DBError "vaultQuery1: Multiple results, expected one row"

vaultQueryMany ::
  (HasCallStack, Default Unpackspec x x, Default FromFields x y) =>
  Query x ->
  VaultM [y]
vaultQueryMany q =
  vaultQuery q >>= \case
    [] -> vaultWrapperError $ DBError "No result, expected atleast one"
    (x : xs) -> return (x : xs)

vaultModify :: HasCallStack => (Connection -> IO x) -> VaultM x
vaultModify modify = do
  logInfoCS callStack "Updating the database"
  pool <- asks dbPool
  liftIO $ withResource pool modify

vaultModify1 :: HasCallStack => (Connection -> IO [x]) -> VaultM x
vaultModify1 modify = do
  logInfoCS callStack "Updating the database"
  results <- vaultModify modify
  case results of
    [] -> throwIO $ DBError "No result, expected one row"
    [y] -> return y
    _ : _ : _ -> throwIO $ DBError "Multiple results, expected one row"

vaultTransaction :: VaultM x -> VaultM x
vaultTransaction vaultAction = do
    pool <- asks dbPool
    env  <- ask
    liftIO $ withResource pool $ \conn -> withTransaction conn (runLoggingT (runReaderT vaultAction env))

vaultMaybe :: Text -> Maybe x -> VaultM x
vaultMaybe msg = maybe (throwIO (CouldNotFind msg)) return







