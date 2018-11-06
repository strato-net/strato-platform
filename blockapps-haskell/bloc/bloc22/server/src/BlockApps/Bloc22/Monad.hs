{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE ImplicitParams             #-}
{-# LANGUAGE LambdaCase                 #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE RecordWildCards            #-}
{-# LANGUAGE TypeFamilies               #-}

module BlockApps.Bloc22.Monad where


import           Control.Exception.Lifted           hiding (Handler, handle)
import Data.Pool (Pool, withResource)
import           Control.Monad.Base
import           Control.Monad.Except
import           Control.Monad.Log                  hiding (Handler)
import           Control.Monad.Reader
import           Control.Monad.Trans.Control
import qualified Data.Aeson                         as JSON
import qualified Data.ByteString.Lazy.Char8         as Lazy.Char8
import           Data.Foldable
import qualified Data.HashMap.Lazy                  as HashMap
import           Data.Maybe                         (fromMaybe)
import           Data.Profunctor.Product.Default
import           Data.String
import           Data.Text                          (Text)
import qualified Data.Text                          as Text
import           Data.Text.Prettyprint.Doc
import           Data.Time.Format
import           Database.PostgreSQL.Simple         (Connection,
                                                     withTransaction)
import           GHC.Stack
import           Network.HTTP.Client
import           Network.HTTP.Media
import           Network.HTTP.Types.Status
import           Opaleye
import           Servant
import           Servant.Client

newtype Bloc x = Bloc
  { runBloc ::
      ReaderT BlocEnv -- global immutable environment variable
        ( LoggingT (WithSeverity (WithCallStack (WithTimestamp Text))) -- log all the things
          ( ExceptT BlocError IO ) -- throw and catch errors
        ) x
  } deriving
  ( Functor
  , Applicative
  , Monad
  , MonadIO
  , MonadBase IO
  , MonadReader BlocEnv
  , MonadLog (WithSeverity (WithCallStack (WithTimestamp Text)))
  )


instance MonadError BlocError Bloc where
  throwError err@(RuntimeError _) = do
    logWith logError (Text.pack $ formatError err ++ "\n  callstack missing for runtime errors")
    Bloc $ throwError err
  throwError err = do
    logWith logError (Text.pack (formatError err))
    Bloc $ throwError err
  catchError m handle =
    Bloc $ catchError (runBloc m) (runBloc . handle)

dbErrorToUserError :: MonadError BlocError m => m a -> m a
dbErrorToUserError = flip catchError $ \case
                       DBError msg -> throwError (UserError msg)
                       err         -> throwError err

toUserError :: MonadError BlocError m => Text -> m a -> m a
toUserError msg = flip catchError (\_ -> throwError $ UserError msg)

-- I am not sure if the logs should just print out the raw errors, or if we should pretty them up a bit.  I'll add this function for now, we can toy with it both ways.
formatError::BlocError->String
formatError (StratoError FailureResponse{responseBody=e}) = "StratoError:\n" ++ compensateForTheOddStratoApiFormattingAndPullOutTheMessage e
formatError e = show e


--prettyCallStack' is the same idea as prettyCallStack, but with formatting more suitable for out project.  In particular, package names a very mangled by stack, making prettyCallStack unreadable.
prettyCallStack'::CallStack->String
prettyCallStack' cs =
  "CallStack:\n" ++ unlines (map formatCSLine $ getCallStack cs)
  where
    formatCSLine (funcName, SrcLoc{..}) =
      "  " ++ funcName ++ ", called at " ++ srcLocModule ++ ":" ++ show srcLocStartLine ++ ":" ++ show srcLocStartCol

blocError::HasCallStack=>BlocError->Bloc y
blocError err = do
    logWithCallStack ?callStack logError (Text.pack (show err ++ "\n" ++ prettyCallStack' ?callStack))
    Bloc $ throwError err



instance MonadBaseControl IO Bloc where
  type StM Bloc x = Either BlocError x
  liftBaseWith f = Bloc $ liftBaseWith $ \q -> f (q . runBloc)
  restoreM = Bloc . restoreM

data DeployMode = Enterprise | Public deriving (Eq, Enum, Show, Ord)

data BlocEnv = BlocEnv
  { urlStrato       :: BaseUrl
  , urlVaultWrapper :: BaseUrl
  , httpManager     :: Manager
  , dbPool          :: Pool Connection
  , logLevel        :: Severity
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
  deriving Show

--------------------------------------------------------------------------------
boxIt::String->String
boxIt string =
  replicate (len+4) '=' ++ "\n"
  ++ unlines (map (\x -> "| " ++ x ++ " |") theLines)
  ++ replicate (len+4) '='
  where
    len = Prelude.maximum $ map length theLines
    theLines = lines string

filterPrintLog::MonadIO m=>Severity->WithSeverity (WithCallStack (WithTimestamp Text))->m ()
filterPrintLog minSeverity x | msgSeverity x >= minSeverity = return ()
filterPrintLog _ x =
    liftIO . print . render pretty $ x
  where
    render :: (a0 -> Doc ann) -> WithSeverity (WithCallStack (WithTimestamp a0)) -> Doc ann
    render = renderWithSeverity
           . renderLocation
           . renderWithTimestamp (formatTime defaultTimeLocale $ iso8601DateFormat (Just "%H:%M:%S"))

renderLocation:: (a -> Doc ann) -> WithCallStack a -> Doc ann
renderLocation k (WithCallStack stack msg) =
  fill 40 (pretty (formatTopLocation $ getCallStack stack)) <> k msg

enterBloc :: BlocEnv -> Bloc x -> Handler x
enterBloc env x
  = Handler
  $ withExceptT reThrowError
  $ flip runLoggingT (filterPrintLog $ logLevel env)
  $ flip runReaderT env $ runBloc
  $ convertRuntimeErrors x
  where
    convertRuntimeErrors::Bloc x->Bloc x
    convertRuntimeErrors f = do
      val <- try f
      case val of
       Left e  -> throwError $ RuntimeError e
       Right v -> return v
    reThrowError :: BlocError -> ServantErr
    reThrowError
      = \case
          StratoError (FailureResponse url' Status{statusCode=404} responseContentType' responseBody') | mainType responseContentType' == "text" && subType responseContentType' == "plain" ->
            err500{errBody = fromString $ unlines
                   [
                     "Error!",
                     "Bloc seems to be improperly configured: Strato page " ++ show url' ++ "is missing.",
                     "Please contact your network administrator to have this problem fixed.",
                     "Response from server:",
                     boxIt $ Lazy.Char8.unpack responseBody'
                   ]}
          StratoError (FailureResponse url' Status{statusCode=404} _ _) ->
            err500{errBody = fromString $ unlines
                   [
                     "Error!",
                     "Bloc seems to be improperly configured: Strato page " ++ show url' ++ "is missing.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          StratoError FailureResponse{..} | statusIsClientError responseStatus ->
            err400{errBody= Lazy.Char8.pack $ compensateForTheOddStratoApiFormattingAndPullOutTheMessage responseBody}
          StratoError (ConnectionError _) ->
            err500{errBody = fromString $ unlines
                   [
                     "Error!",
                     "Bloc can not connect to Strato.",
                     "This probably is a configuration error, but can also mean the Strato peer is down.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          StratoError _ ->
            err500{errBody = fromString $ unlines
                   [
                     "Error!",
                     "Bloc recieved a malformed response from Strato.",
                     "This is probably a backend configuration problem.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          VaultWrapperError FailureResponse{..} | statusIsClientError responseStatus ->
            err400{errBody= Lazy.Char8.pack $ compensateForTheOddStratoApiFormattingAndPullOutTheMessage responseBody}
          VaultWrapperError (ConnectionError _) ->
            err500{errBody = fromString $ unlines
                   [
                     "Error!",
                     "Bloc can not connect to Strato.",
                     "This probably is a configuration error, but can also mean the Strato peer is down.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          VaultWrapperError _ ->
            err500{errBody = fromString $ unlines
                   [
                     "Error!",
                     "Bloc recieved a malformed response from Strato.",
                     "This is probably a backend configuration problem.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          DBError _ ->
            err500{errBody = fromString $ unlines
                   [
                     "Internal Error!",
                     "Something is broken in the Bloc Server database.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          CirrusError err -> err500{errBody = Lazy.Char8.pack (show err)}
          UserError err -> err400{errBody = fromString $ show err}
          AlreadyExists err -> err409{errBody = fromString $ show err}
          CouldNotFind err -> err404{errBody = fromString $ show err}
          AnError _ ->
            err500{errBody = fromString $ unlines
                   [
                     "Internal Error!",
                     "Something is broken in the Bloc Server.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          Unimplemented err ->
            err501{errBody = fromString $ unlines
                   [
                     "Internal Error!",
                     "You are using a feature of the Bloc Server that has not yet been implemented.",
                     Text.unpack err
                   ]}
          RuntimeError _ -> err500{errBody = fromString $ unlines
                   [
                     "Internal Error!",
                     "Something wrong has happened inside of bloc.",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}


--This is an annoyingly named and poorly written function, deliberately designed that way to remind us that we need to clean up the response from strato-api/solc.
compensateForTheOddStratoApiFormattingAndPullOutTheMessage::Lazy.Char8.ByteString->String
compensateForTheOddStratoApiFormattingAndPullOutTheMessage x | "Invalid Arguments" `Lazy.Char8.isPrefixOf` x =
   case JSON.decode $ Lazy.Char8.drop 18 x of
     Nothing -> error $ "the server has given me another odd response I did not expect, please add code to deal with this: " ++ show x
     Just o -> fromMaybe errMsg (HashMap.lookup ("error" :: Text) o)
                  where errMsg = error $ "the server has given me another odd response I did not expect, please add code to deal with this: " ++ show x
compensateForTheOddStratoApiFormattingAndPullOutTheMessage x = error $ "the server has given me another odd response I did not expect, please add code to deal with this: " ++ show x


formatTopLocation::[(String, SrcLoc)]->String
formatTopLocation [] = "[-]"
formatTopLocation ((_, x):_) = "[" ++ srcLocModule x ++ ":" ++ show (srcLocStartLine x) ++ "]"


logWithCallStack
  :: CallStack
  -> (WithCallStack (WithTimestamp x) -> Bloc ()) -> x -> Bloc ()
logWithCallStack stack logFn x = logFn . WithCallStack stack =<< timestamp x

logWith
  :: HasCallStack
  => (WithCallStack (WithTimestamp x) -> Bloc ()) -> x -> Bloc ()
logWith = logWithCallStack callStack

blocQuery
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> Bloc [y]
blocQuery q = do
  traverse_ (logWithCallStack callStack logNotice . Text.pack) (showSql q)
  pool <- asks dbPool
  withResource pool $ liftIO . flip runQuery q

blocQueryMaybe
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> Bloc (Maybe y)
blocQueryMaybe q = blocQuery q >>= \case
    [] -> return Nothing
    [y] -> return (Just y)
    _:_:_ -> throwError $ DBError "blocQueryMaybe: Multiple results, expected one row"

blocQuery1
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Text
  -> Query x
  -> Bloc y
blocQuery1 loc q = blocQuery q >>= \case
    [] -> blocError . DBError . Text.concat $ ["blocQuery1: ", loc, ": No result, expected one row"]
    [y] -> return y
    _:_:_ -> throwError . DBError . Text.concat $
       ["blocQuery1: ", loc, ": Multiple results, expected one row"]

blocModify :: HasCallStack => (Connection -> IO x) -> Bloc x
blocModify modify = do
  logWithCallStack callStack logNotice "Updating the database"
  pool <- asks dbPool
  withResource pool (liftIO . modify)

blocModify1 :: HasCallStack => (Connection -> IO [x]) -> Bloc x
blocModify1 modify = do
  logWithCallStack callStack logNotice "Updating the database"
  results <- blocModify modify
  case results of
    []    -> throwError $ DBError "No result, expected one row"
    [y]   -> return y
    _:_:_ -> throwError $ DBError "Multiple results, expected one row"

blocTransaction :: Bloc x -> Bloc x
blocTransaction bloc = do
  pool <- asks dbPool
  withResource pool $ (\conn -> liftBaseOp_ (withTransaction conn) bloc)

blocStrato :: HasCallStack => ClientM x -> Bloc x
blocStrato client' = do
  logWithCallStack callStack logNotice "Querying Strato"
  url <- asks urlStrato
  mngr <- asks httpManager
  resultEither <- liftIO $ runClientM client' (ClientEnv mngr url)
  either (blocError . StratoError) return resultEither

blocVaultWrapper :: HasCallStack => ClientM x -> Bloc x
blocVaultWrapper client' = do
  logWithCallStack callStack logNotice "Querying Vault Wrapper"
  url <- asks urlVaultWrapper
  mngr <- asks httpManager
  resultEither <- liftIO $ runClientM client' (ClientEnv mngr url)
  either (blocError . VaultWrapperError) return resultEither

blocMaybe :: Text -> Maybe x -> Bloc x
blocMaybe msg = maybe (throwError (CouldNotFind msg)) return
{-
blocCirrusFireForget :: HasCallStack => ClientM x -> Bloc Bool
blocCirrusFireForget client' = do
  logWithCallStack callStack logNotice "Querying Cirrus"
  url <- asks urlCirrus
  mngr <- asks httpManager
  resultEither <- liftIO $ runClientM client' (ClientEnv mngr url)
  case resultEither of
    Left err -> do
      logWith logError (Text.pack $ show err ++ "\n  Cirrus returned an error")
      return False
    Right _ -> return True

blocCirrus :: HasCallStack => ClientM x -> Bloc x
blocCirrus client' = do
  logWithCallStack callStack logNotice "Querying Cirrus"
  url <- asks urlCirrus
  mngr <- asks httpManager
  resultEither <- liftIO $ runClientM client' (ClientEnv mngr url)
  either (throwError . CirrusError) return resultEither
-}
