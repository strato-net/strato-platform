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

module BlockApps.Bloc22.Monad where


import           Control.Monad.Reader
import           Control.Monad.Trans.Control
import           Control.Monad.Trans.Except
import qualified Data.Aeson                         as JSON
import qualified Data.ByteString.Lazy.Char8         as Lazy.Char8
import           Data.Foldable
import qualified Data.HashMap.Lazy                  as HashMap
import           Data.Maybe                         (fromMaybe)
import           Data.Pool (Pool, withResource)
import           Data.Profunctor.Product.Default
import           Data.Text                          (Text)
import qualified Data.Text                          as Text
import           Database.PostgreSQL.Simple         (Connection,
                                                     withTransaction)
import           GHC.Stack
import           Network.HTTP.Client                hiding (responseBody)
import           Network.HTTP.Types.Status
import           Opaleye
import           Servant
import           Servant.Client
import           Text.Printf

import           UnliftIO                           hiding (Handler(..))

import           BlockApps.Logging

type Bloc = ReaderT BlocEnv (LoggingT IO)

dbErrorToUserError :: MonadUnliftIO m => m a -> m a
dbErrorToUserError = flip catch $ \case
                       DBError msg -> throwIO (UserError msg)
                       err         -> throwIO err

toUserError :: MonadUnliftIO m => Text -> m a -> m a
toUserError msg = flip catch (\(_ :: SomeException) -> throwIO $ UserError msg)

-- I am not sure if the logs should just print out the raw errors, or if we should pretty them up a bit.  I'll add this function for now, we can toy with it both ways.

formatError::BlocError->String
formatError (StratoError (FailureResponse Response{responseBody=e})) = "StratoError:\n" ++ compensateForTheOddStratoApiFormattingAndPullOutTheMessage e
formatError e = show e


--prettyCallStack' is the same idea as prettyCallStack, but with formatting more suitable for out project.  In particular, package names a very mangled by stack, making prettyCallStack unreadable.
prettyCallStack'::CallStack->String
prettyCallStack' cs =
  "CallStack:\n" ++ unlines (map formatCSLine $ getCallStack cs)
  where
    formatCSLine (funcName, SrcLoc{..}) =
      "  " ++ funcName ++ ", called at " ++ srcLocModule ++ ":" ++ show srcLocStartLine ++ ":" ++ show srcLocStartCol

blocError :: HasCallStack => BlocError -> Bloc y
blocError err = do
    logErrorCS callStack . Text.pack $
      printf "err: %s\nCallstack:%s" (show err) (prettyCallStack callStack)
    throwIO err

data DeployMode = Enterprise | Public deriving (Eq, Enum, Show, Ord)

data BlocEnv = BlocEnv
  { urlStrato       :: BaseUrl
  , urlVaultWrapper :: BaseUrl
  , httpManager     :: Manager
  , dbPool          :: Pool Connection
  , deployMode      :: DeployMode
  , stateFetchLimit :: Integer
  }

data BlocError
  = StratoError ServantError
  | CirrusError ServantError
  | VaultWrapperError ServantError
  | DBError Text
  | UserError Text
  | CouldNotFind Text
  | AnError Text
  | Unimplemented Text
  | AlreadyExists Text
  | RuntimeError SomeException
  | UnavailableError Text
  | InternalError Text
  deriving (Show, Exception)

--------------------------------------------------------------------------------

runBlocWithEnv :: BlocEnv -> Bloc a -> IO a
runBlocWithEnv env = runLoggingT
                   . flip runReaderT env

runBlocToIO :: BlocEnv -> Bloc a -> IO (Either BlocError a)
runBlocToIO env = try . runBlocWithEnv env

handleRuntimeError :: SomeException -> Bloc a
handleRuntimeError (e :: SomeException) = case fromException e of
  Just (_ :: BlocError) -> throwIO e
  Nothing -> throwIO $ RuntimeError e

handleBlocError :: BlocError -> Bloc a
handleBlocError = \case
  e@(RuntimeError _) -> do
    $logErrorS "handleBlocError/RuntimeError" . Text.pack $
      formatError e ++ "\n  callstack missing for runtime errors"
    throwIO e
  e -> do
    $logErrorS "handleBlocError" . Text.pack $ formatError e
    throwIO e

enterBloc :: BlocEnv -> Bloc x -> Handler x
enterBloc env x = Handler $ do
  eRes <- liftIO . runBlocToIO env $ x `catch` handleRuntimeError `catch` handleBlocError
  case eRes of
    Right a -> return a
    Left e -> throwE $ reThrowError e
  where
    reThrowError :: BlocError -> ServantErr
    reThrowError
      = \case
          StratoError (FailureResponse Response{..}) 
            | responseStatusCode == status404 ->
                err404{errBody = JSON.encode $ unlines
                   [
                     "Strato Error!",
                     "Bloc seems to be improperly configured: Strato page is missing.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)",
                     "Error Message:",
                     compensateForTheOddStratoApiFormattingAndPullOutTheMessage responseBody
                   ]}
            | statusIsClientError responseStatusCode ->
                err400{errBody= JSON.encode $ compensateForTheOddStratoApiFormattingAndPullOutTheMessage responseBody}
          StratoError (ConnectionError _) ->
            err500{errBody = JSON.encode $ unlines
                   [
                     "Strato Error!",
                     "Bloc can not connect to Strato.",
                     "This probably is a configuration error, but can also mean the Strato peer is down.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          StratoError _ ->
            err500{errBody = JSON.encode $ unlines
                   [
                     "Strato Error!",
                     "Bloc recieved a malformed response from Strato.",
                     "This is probably a backend configuration problem.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          VaultWrapperError (FailureResponse Response{..}) | responseStatusCode == status503 ->
            err503{errBody = responseBody}
                                                           | statusIsClientError responseStatusCode ->
            err400{errBody = responseBody } 
          VaultWrapperError (ConnectionError _) ->
            err500{errBody = JSON.encode $ unlines
                   [
                     "Connection Error!",
                     "Bloc can not connect to the Vault Wrapper.",
                     "This probably is a configuration error, but can also mean the Strato peer is down.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          VaultWrapperError _ ->
            err500{errBody = JSON.encode $ unlines
                   [
                     "Vault-Wrapper Error!",
                     "Bloc recieved a malformed response from Vault-Wrapper.",
                     "This is probably a backend configuration problem.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          DBError _ ->
            err500{errBody = JSON.encode $ unlines
                   [
                     "Database Error!",
                     "Something is broken in the Bloc Server database.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          CirrusError err -> err500{errBody = JSON.encode (show err)}
          UserError err -> err400{errBody = JSON.encode err}
          AlreadyExists err -> err409{errBody = JSON.encode err}
          CouldNotFind err -> err404{errBody = JSON.encode err}
          UnavailableError err -> err503{errBody = JSON.encode err}
          AnError _ ->
            err500{errBody = JSON.encode $ unlines
                   [
                     "Internal Error!",
                     "Something is broken in the Bloc Server.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          Unimplemented err ->
            err501{errBody = JSON.encode $ unlines
                   [
                     "Unimplemented Error",
                     "You are using a feature of the Bloc Server that has not yet been implemented.",
                     Text.unpack err
                   ]}
          RuntimeError _ -> err500{errBody = JSON.encode $ unlines
                   [
                     "Runtime Error!",
                     "Something wrong has happened inside of bloc.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          InternalError err -> err500{errBody = JSON.encode $ unlines
                   [ "Internal Error!",
                     "Bloc couldn't process that request.",
                     "Please contact your network administrator.",
                     "Error Message:",
                     Text.unpack err
                   ]}


--This is an annoyingly named and poorly written function, deliberately designed that way to remind us that we need to clean up the response from strato-api/solc.
compensateForTheOddStratoApiFormattingAndPullOutTheMessage :: Lazy.Char8.ByteString -> String
compensateForTheOddStratoApiFormattingAndPullOutTheMessage x | "Invalid Arguments" `Lazy.Char8.isPrefixOf` x =
   case JSON.decode $ Lazy.Char8.drop 18 x of
     Nothing -> show x
     Just o -> fromMaybe (show x) (HashMap.lookup ("error" :: Text) o)
compensateForTheOddStratoApiFormattingAndPullOutTheMessage x = show x


formatTopLocation::[(String, SrcLoc)]->String
formatTopLocation [] = "[-]"
formatTopLocation ((_, x):_) = "[" ++ srcLocModule x ++ ":" ++ show (srcLocStartLine x) ++ "]"

blocQuery
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> Bloc [y]
blocQuery q = do
  traverse_ (logInfoCS callStack . Text.pack) (showSql q)
  pool <- asks dbPool
  withResource pool $ liftIO . flip runQuery q

blocQueryMaybe
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> Bloc (Maybe y)
blocQueryMaybe q = blocQuery q >>= \case
    [] -> return Nothing
    [y] -> return (Just y)
    _:_:_ -> throwIO $ DBError "blocQueryMaybe: Multiple results, expected one row"

blocQuery1
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Text
  -> Query x
  -> Bloc y
blocQuery1 loc q = blocQuery q >>= \case
    [] -> blocError . DBError . Text.concat $ ["blocQuery1: ", loc, ": No result, expected one row"]
    [y] -> return y
    _:_:_ -> throwIO . DBError . Text.concat $
       ["blocQuery1: ", loc, ": Multiple results, expected one row"]

blocModify :: HasCallStack => (Connection -> IO x) -> Bloc x
blocModify modify = do
  logInfoCS callStack "Updating the database"
  pool <- asks dbPool
  withResource pool (liftIO . modify)

blocModify1 :: HasCallStack => (Connection -> IO [x]) -> Bloc x
blocModify1 modify = do
  logInfoCS callStack "Updating the database"
  results <- blocModify modify
  case results of
    []    -> throwIO $ DBError "No result, expected one row"
    [y]   -> return y
    _:_:_ -> throwIO $ DBError "Multiple results, expected one row"

blocTransaction :: Bloc x -> Bloc x
blocTransaction bloc = do
  pool <- asks dbPool
  withResource pool (\conn -> liftBaseOp_ (withTransaction conn) bloc)

blocStrato :: HasCallStack => ClientM x -> Bloc x
blocStrato client' = do
  logInfoCS callStack "Querying Strato"
  url <- asks urlStrato
  mngr <- asks httpManager
  resultEither <- liftIO $ runClientM client' (ClientEnv mngr url Nothing)
  either (blocError . StratoError) return resultEither

blocVaultWrapper :: HasCallStack => ClientM x -> Bloc x
blocVaultWrapper client' = do
  logInfoCS callStack "Querying Vault Wrapper"
  url <- asks urlVaultWrapper
  mngr <- asks httpManager
  resultEither <- liftIO $ runClientM client' (ClientEnv mngr url Nothing)
  either (blocError . VaultWrapperError) return resultEither

blocMaybe :: Text -> Maybe x -> Bloc x
blocMaybe msg = maybe (throwIO (CouldNotFind msg)) return
