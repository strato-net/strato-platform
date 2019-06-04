{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE ImplicitParams             #-}
{-# LANGUAGE LambdaCase                 #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE RecordWildCards            #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}

module Strato.Strato23.Monad where

import           Control.Exception.Lifted        hiding (Handler, handle)
import           Data.Pool                       (Pool, withResource)
import           Control.Monad.Base
import           Control.Monad.Except
import           Control.Monad.Reader
import           Control.Monad.Trans.Control
import           Data.Foldable
import           Data.IORef
import           Data.Profunctor.Product.Default
import           Data.String
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import           Database.PostgreSQL.Simple      (Connection,
                                                  withTransaction)
import           GHC.Stack
import           Network.HTTP.Client
import           Opaleye
import           Servant

import           BlockApps.Logging

newtype VaultM x = VaultM
  { runVaultM ::
      ReaderT VaultWrapperEnv
        ( LoggingT
          ( ExceptT VaultWrapperError IO )
        ) x
  } deriving
  ( Functor
  , Applicative
  , Monad
  , MonadIO
  , MonadBase IO
  , MonadReader VaultWrapperEnv
  , MonadLogger
  )


instance MonadError VaultWrapperError VaultM where
  throwError err@(RuntimeError _) = do
    $logErrorS "throwError/RuntimeError" . Text.pack
        $ show err ++ "\n  callstack missing for runtime errors"
    VaultM $ throwError err
  throwError err = do
    $logErrorLS "throwError" err
    VaultM $ throwError err
  catchError m handle = do
    VaultM $ catchError (runVaultM m) (runVaultM . handle)

dbErrorToUserError :: MonadError VaultWrapperError m => m a -> m a
dbErrorToUserError = flip catchError $ \case
                       DBError msg -> throwError (UserError msg)
                       err         -> throwError err

toUserError :: MonadError VaultWrapperError m => Text -> m a -> m a
toUserError msg = flip catchError (\_ -> throwError $ UserError msg)

--prettyCallStack' is the same idea as prettyCallStack, but with formatting more suitable for out project.  In particular, package names a very mangled by stack, making prettyCallStack unreadable.
prettyCallStack'::CallStack->String
prettyCallStack' cs =
  "CallStack:\n" ++ unlines (map formatCSLine $ getCallStack cs)
  where
    formatCSLine (funcName, SrcLoc{..}) =
      "  " ++ funcName ++ ", called at " ++ srcLocModule ++ ":" ++ show srcLocStartLine ++ ":" ++ show srcLocStartCol

vaultWrapperError :: HasCallStack => VaultWrapperError -> VaultM y
vaultWrapperError err = do
    logErrorCS callStack . Text.pack $ show err ++ "\n" ++ prettyCallStack' ?callStack
    VaultM $ throwError err


instance MonadBaseControl IO VaultM where
  type StM VaultM x = Either VaultWrapperError x
  liftBaseWith f = VaultM $ liftBaseWith $ \q -> f (q . runVaultM)
  restoreM = VaultM . restoreM

data VaultWrapperEnv = VaultWrapperEnv
  { httpManager         :: Manager
  , dbPool              :: Pool Connection
  , superSecretPassword :: IORef (Maybe Text)
  }

data VaultWrapperError
  = DBError Text
  | UserError Text
  | CouldNotFind Text
  | AnError Text
  | Unimplemented Text
  | AlreadyExists Text
  | RuntimeError SomeException
  deriving Show

--------------------------------------------------------------------------------

enterVaultWrapper :: VaultWrapperEnv -> VaultM x -> Handler x
enterVaultWrapper env x
  = Handler
  $ withExceptT reThrowError
  $ runLoggingT
  $ flip runReaderT env $ runVaultM
  $ convertRuntimeErrors x
  where
    convertRuntimeErrors :: VaultM x -> VaultM x
    convertRuntimeErrors f = do
      val <- try f
      case val of
       Left e  -> throwError $ RuntimeError e
       Right v -> return v
    reThrowError :: VaultWrapperError -> ServantErr
    reThrowError
      = \case
          DBError _ ->
            err500{errBody = fromString $ unlines
                   [
                     "Internal Error!",
                     "Something is broken in the Vault Wrapper Server database.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Vault Wrapper logs.)"
                   ]}
          UserError err -> err400{errBody = fromString $ show err}
          AlreadyExists err -> err409{errBody = fromString $ show err}
          CouldNotFind err -> err404{errBody = fromString $ show err}
          AnError _ ->
            err500{errBody = fromString $ unlines
                   [
                     "Internal Error!",
                     "Something is broken in the Vault Wrapper Server.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Vault Wrapper logs.)"
                   ]}
          Unimplemented err ->
            err501{errBody = fromString $ unlines
                   [
                     "Internal Error!",
                     "You are using a feature of the Vault Wrapper Server that has not yet been implemented.",
                     Text.unpack err
                   ]}
          RuntimeError _ -> err500{errBody = fromString $ unlines
                   [
                     "Internal Error!",
                     "Something wrong has happened inside of Vault Wrapper.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Vault Wrapper logs.)"
                   ]}

formatTopLocation::[(String, SrcLoc)]->String
formatTopLocation [] = "[-]"
formatTopLocation ((_, x):_) = "[" ++ srcLocModule x ++ ":" ++ show (srcLocStartLine x) ++ "]"

vaultQuery
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> VaultM [y]
vaultQuery q = do
  traverse_ (logInfoCS callStack . Text.pack) (showSql q)
  pool <- asks dbPool
  withResource pool $ (\conn -> liftIO $ runQuery conn q)

vaultQueryMaybe
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> VaultM (Maybe y)
vaultQueryMaybe q = vaultQuery q >>= \case
    [] -> return Nothing
    [y] -> return (Just y)
    _:_:_ -> throwError $ DBError "vaultQueryMaybe: Multiple results, expected one row"

vaultQuery1
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> VaultM y
vaultQuery1 q = vaultQuery q >>= \case
    [] -> vaultWrapperError $ DBError "No result, expected one row"
    [y] -> return y
    _:_:_ -> throwError $ DBError "vaultQuery1: Multiple results, expected one row"

vaultModify :: HasCallStack => (Connection -> IO x) -> VaultM x
vaultModify modify = do
  logInfoCS callStack "Updating the database"
  pool <- asks dbPool
  withResource pool $ (\conn -> liftIO $ modify conn)

vaultModify1 :: HasCallStack => (Connection -> IO [x]) -> VaultM x
vaultModify1 modify = do
  logInfoCS callStack "Updating the database"
  results <- vaultModify modify
  case results of
    []    -> throwError $ DBError "No result, expected one row"
    [y]   -> return y
    _:_:_ -> throwError $ DBError "Multiple results, expected one row"

vaultTransaction :: VaultM x -> VaultM x
vaultTransaction vault = do
  pool <- asks dbPool
  withResource pool $ (\conn -> liftBaseOp_ (withTransaction conn) vault)

vaultMaybe :: Text -> Maybe x -> VaultM x
vaultMaybe msg = maybe (throwError (CouldNotFind msg)) return
