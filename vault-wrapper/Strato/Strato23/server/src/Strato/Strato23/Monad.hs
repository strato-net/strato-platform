{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE ImplicitParams             #-}
{-# LANGUAGE LambdaCase                 #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE RecordWildCards            #-}
{-# LANGUAGE TypeFamilies               #-}

module Strato.Strato23.Monad where

import           Control.Exception.Lifted        hiding (Handler, handle)
import           Data.Pool                       (Pool, withResource)
import           Control.Monad.Base
import           Control.Monad.Except
import           Control.Monad.Log               hiding (Handler)
import           Control.Monad.Reader
import           Control.Monad.Trans.Control
import qualified Data.Aeson                      as JSON
import qualified Data.ByteString.Lazy.Char8      as Lazy.Char8
import           Data.Foldable
import qualified Data.HashMap.Lazy               as HashMap
import           Data.Maybe                      (fromMaybe)
import           Data.Profunctor.Product.Default
import           Data.String
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import           Data.Time.Format
import           Database.PostgreSQL.Simple      (Connection,
                                                  withTransaction)
import           GHC.Stack
import           Network.HTTP.Client
import           Network.HTTP.Media
import           Network.HTTP.Types.Status
import           Opaleye
import           Servant
import           Servant.Client
import qualified Text.PrettyPrint.Leijen.Text    as Leijen

newtype VaultM x = VaultM
  { runVaultM ::
      ReaderT VaultWrapperEnv
        ( LoggingT (WithSeverity (WithCallStack (WithTimestamp Text)))
          ( ExceptT VaultWrapperError IO )
        ) x
  } deriving
  ( Functor
  , Applicative
  , Monad
  , MonadIO
  , MonadBase IO
  , MonadReader VaultWrapperEnv
  , MonadLog (WithSeverity (WithCallStack (WithTimestamp Text)))
  )


instance MonadError VaultWrapperError VaultM where
  throwError err@(RuntimeError _) = do
    logWith logError (Text.pack $ formatError err ++ "\n  callstack missing for runtime errors")
    VaultM $ throwError err
  throwError err = do
    logWith logError (Text.pack (formatError err))
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
    logWithCallStack ?callStack logError (Text.pack (show err ++ "\n" ++ prettyCallStack' ?callStack))
    VaultM $ throwError err



instance MonadBaseControl IO VaultM where
  type StM VaultM x = Either VaultWrapperError x
  liftBaseWith f = VaultM $ liftBaseWith $ \q -> f (q . runVaultM)
  restoreM = VaultM . restoreM

data VaultWrapperEnv = VaultWrapperEnv
  { httpManager  :: Manager
  , dbPool       :: Pool Connection
  , logLevel     :: Severity
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
boxIt :: String -> String
boxIt string =
  replicate (len+4) '=' ++ "\n"
  ++ unlines (map (\x -> "| " ++ x ++ " |") theLines)
  ++ replicate (len+4) '='
  where
    len = Prelude.maximum $ map length theLines
    theLines = lines string

filterPrintLog :: MonadIO m => Severity -> WithSeverity (WithCallStack (WithTimestamp Text)) -> m ()
filterPrintLog minSeverity x | msgSeverity x >= minSeverity = return ()
filterPrintLog _ x =
  liftIO . print . render Leijen.stringStrict $ x
  where
    render::(a0 -> Leijen.Doc)
            -> WithSeverity (WithCallStack (WithTimestamp a0))
            -> Leijen.Doc
    render
      = renderWithSeverity
      . renderLocation
      . renderWithTimestamp
          (formatTime defaultTimeLocale $ iso8601DateFormat (Just "%H:%M:%S"))

enterVaultWrapper :: VaultWrapperEnv -> VaultM x -> Handler x
enterVaultWrapper env x
  = Handler
  $ withExceptT reThrowError
  $ flip runLoggingT (filterPrintLog $ logLevel env)
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

renderLocation::(a -> Leijen.Doc)->WithCallStack a->Leijen.Doc
renderLocation k (WithCallStack stack msg) =
  Leijen.fill 40 (Leijen.string (fromString $ formatTopLocation $ getCallStack stack)) Leijen.<> k msg

formatTopLocation::[(String, SrcLoc)]->String
formatTopLocation [] = "[-]"
formatTopLocation ((_, x):_) = "[" ++ srcLocModule x ++ ":" ++ show (srcLocStartLine x) ++ "]"


logWithCallStack
  :: CallStack
  -> (WithCallStack (WithTimestamp x) -> VaultM ()) -> x -> VaultM ()
logWithCallStack stack logFn x = logFn . WithCallStack stack =<< timestamp x

logWith
  :: HasCallStack
  => (WithCallStack (WithTimestamp x) -> VaultM ()) -> x -> VaultM ()
logWith = logWithCallStack callStack

vaultQuery
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> VaultM [y]
vaultQuery q = do
  traverse_ (logWithCallStack callStack logNotice . Text.pack) (showSql q)
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
    [] -> vaultError $ DBError "No result, expected one row"
    [y] -> return y
    _:_:_ -> throwError $ DBError "vaultQuery1: Multiple results, expected one row"

vaultModify :: HasCallStack => (Connection -> IO x) -> VaultM x
vaultModify modify = do
  logWithCallStack callStack logNotice "Updating the database"
  pool <- asks dbPool
  withResource pool $ (\conn -> liftIO $ modify conn)

vaultModify1 :: HasCallStack => (Connection -> IO [x]) -> VaultM x
vaultModify1 modify = do
  logWithCallStack callStack logNotice "Updating the database"
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
