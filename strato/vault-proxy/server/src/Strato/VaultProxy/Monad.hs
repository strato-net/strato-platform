{-# LANGUAGE DeriveAnyClass             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE ImplicitParams             #-}
{-# LANGUAGE LambdaCase                 #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE RecordWildCards            #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}

module Strato.VaultProxy.Monad where

import           Control.Monad.Reader
import           Control.Monad.Trans.Except
import qualified Data.ByteString.Lazy            as LB
import           Data.String
import           Data.Text                       as T hiding (map, unlines)
import qualified Data.Text                       as Text
import           Data.Text.Encoding
import           GHC.Stack
import           Servant

import           UnliftIO                        hiding (Handler(..))

import           BlockApps.Logging  

import           Strato.VaultProxy.DataTypes        as DT

type VaultProxyM = ReaderT DT.VaultConnection (LoggingT IO)

toUserError :: (MonadUnliftIO m, MonadLogger m) => Text -> m a -> m a
toUserError msg = flip catch $ reportAndConvertError msg
  where
    reportAndConvertError :: (MonadIO m, MonadLogger m) =>
                             Text -> SomeException -> m a
    reportAndConvertError msg' e = do
      $logErrorS "toUserError" $ Text.pack $ "Internal Error: " ++ show e
      throwIO $ UserError msg'

--prettyCallStack' is the same idea as prettyCallStack, but with formatting more suitable for out project.  In particular, package names a very mangled by stack, making prettyCallStack unreadable.
prettyCallStack'::CallStack->String
prettyCallStack' cs =
  "CallStack:\n" ++ unlines (map formatCSLine $ getCallStack cs)
  where
    formatCSLine (funcName, SrcLoc{..}) =
      "  " ++ funcName ++ ", called at " ++ srcLocModule ++ ":" ++ show srcLocStartLine ++ ":" ++ show srcLocStartCol

vaultProxyError :: HasCallStack => VaultProxyError -> VaultProxyM y
vaultProxyError err = do
    logErrorCS callStack . Text.pack $ show err ++ "\n" ++ prettyCallStack' ?callStack
    throwIO err

data VaultProxyError
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

runVaultProxyWithEnv :: VaultConnection -> VaultProxyM a -> IO a
runVaultProxyWithEnv env = runLoggingT
                         . flip runReaderT env

runVaultProxyToIO :: VaultConnection -> VaultProxyM a -> IO (Either VaultProxyError a)
runVaultProxyToIO env = try . runVaultProxyWithEnv env

handleRuntimeError :: SomeException -> VaultProxyM a
handleRuntimeError (e :: SomeException) = case fromException e of
  Just (_ :: VaultProxyError) -> throwIO e
  Nothing -> throwIO $ RuntimeError e

handleVaultProxyError :: VaultProxyError -> VaultProxyM a
handleVaultProxyError = \case
  NoPasswordError -> do
    $logErrorS "handleVaultProxyError/NoPasswordError"
               "Password has not been set. Please set password by calling POST /vault-proxy/password for node to function properly"
    throwIO NoPasswordError
  IncorrectPasswordError -> do
    $logErrorS "handleVaultProxyError/IncorrectPasswordError"
      "The password has been set incorrectly. Please restart the node and supply the correct password."
    throwIO IncorrectPasswordError
  e@(RuntimeError _) -> do
    $logErrorS "handleVaultProxyError/RuntimeError" . Text.pack
        $ show e ++ "\n  callstack missing for runtime errors"
    throwIO e
  e -> do
    $logErrorLS "handleVaultProxyError" e
    throwIO e

enterVaultProxy :: VaultConnection -> VaultProxyM x -> Handler x
enterVaultProxy env x = Handler $ do
  eRes <- liftIO . runVaultProxyToIO env $ x `catch` handleRuntimeError `catch` handleVaultProxyError
  case eRes of
    Right a -> return a
    Left e -> throwE $ reThrowError e
  where
    reThrowError :: VaultProxyError -> ServerError
    reThrowError
      = \case
          DBError err ->
            err500{errBody = fromString $ unlines
                   [
                     "DB Error!",
                     "Something is broken in the STRATO database.",
                     "Please contact your network administrator to have this problem fixed.",
                     "Error Message:",
                     Text.unpack err
                   ]}
          UserError err -> err400{errBody = fromString $ show err}
          UserDoesNotExist t -> err401{errBody = LB.fromStrict $ encodeUtf8 t}
          NoPasswordError ->
            err503{errBody = fromString $ unlines
                   [
                     "No Password for Vault-Proxy!",
                     "STRATO has not been initialized properly.",
                     "Please contact your network administrator to have this problem fixed."
                   ]}
          IncorrectPasswordError ->
            err503{errBody = fromString $ unlines
                   [
                     "Incorrect Password for Vault-Proxy!",
                     "STRATO has not been initialized properly.",
                     "Please contact your network administrator to have this problem fixed."
                   ]}
          AlreadyExists err -> err409{errBody = fromString $ show err}
          CouldNotFind err -> err404{errBody = fromString $ show err}
          AnError err ->
            err500{errBody = fromString $ unlines
                   [
                     "An Error!",
                     "Something is broken in STRATO.",
                     "Please contact your network administrator to have this problem fixed.",
                     "Error Message:",
                     Text.unpack err
                   ]}
          Unimplemented err ->
            err501{errBody = fromString $ unlines
                   [
                     "Unimplemented Error!",
                     "You are using a feature that has not yet been implemented.",
                     Text.unpack err
                   ]}
          RuntimeError _ -> err500{errBody = fromString $ unlines
                   [
                     "Runtime Error!",
                     "Something wrong has happened inside of STRATO.",
                     "Please contact your network administrator to have this problem fixed."
                   ]}

formatTopLocation::[(String, SrcLoc)]->String
formatTopLocation [] = "[-]"
formatTopLocation ((_, x):_) = "[" ++ srcLocModule x ++ ":" ++ show (srcLocStartLine x) ++ "]"


vaultMaybe :: Text -> Maybe x -> VaultProxyM x
vaultMaybe msg = maybe (throwIO (CouldNotFind msg)) return
