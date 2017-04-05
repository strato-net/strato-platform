{-# LANGUAGE
    FlexibleContexts
  , GeneralizedNewtypeDeriving
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeFamilies
  , LambdaCase
#-}

module BlockApps.Bloc.Monad where

import Control.Monad.Base
import Control.Monad.Except
import Control.Monad.Log hiding (Handler)
import Control.Monad.Reader
import Control.Monad.Trans.Control
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import Data.Foldable
import Data.String
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Time.Format
import Database.PostgreSQL.Simple (Connection,withTransaction)
import Data.Profunctor.Product.Default
import GHC.Stack
import Network.HTTP.Client
import Network.HTTP.Media
import Network.HTTP.Types.Status
import Opaleye
import Servant
import Servant.Client
import Servant.Server.Internal.ServantErr
import qualified Text.PrettyPrint.Leijen.Text as Leijen

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
  throwError err = do
    logWith logError (Text.pack (show err))
    Bloc $ throwError err
  catchError m handle = do
    logWith logError "catching error"
    Bloc $ catchError (runBloc m) (runBloc . handle)

instance MonadBaseControl IO Bloc where
  type StM Bloc x = Either BlocError x
  liftBaseWith f = Bloc $ liftBaseWith $ \q -> f (q . runBloc)
  restoreM = Bloc . restoreM

data BlocEnv = BlocEnv
  { urlStrato :: BaseUrl
  , httpManager :: Manager
  , dbConnection :: Connection
  }

data BlocError
  = StratoError ServantError
  | DBError Text
  | UserError Text
  | CouldNotFind Text
  | AnError Text
  | Unimplemented Text
  deriving Show

boxIt::String->String
boxIt string =
  replicate (len+4) '=' ++ "\n"
  ++ unlines (map (\x -> "| " ++ x ++ " |") theLines)
  ++ replicate (len+4) '='
  where
    len = Prelude.maximum $ map length theLines
    theLines = lines string

enterBloc :: BlocEnv -> Bloc x -> Handler x
enterBloc env x
  = Handler
  $ withExceptT reThrowError
  $ flip runLoggingT (liftIO . print . render Leijen.textStrict)
  $ flip runReaderT env $ runBloc x
  where
    reThrowError
      = \case
          StratoError (FailureResponse (Status{statusCode=404}) responseContentType' responseBody') | mainType responseContentType' == "text" && subType responseContentType' == "plain" ->
            err500{errBody = fromString $ unlines
                   [
                     "Error!",
                     "Bloc seems to be improperly configured (Strato pages are missing.)",
                     "Please contact your network administrator to have this problem fixed.",
                     boxIt $ Lazy.Char8.unpack responseBody'
                   ]}
          StratoError (FailureResponse (Status{statusCode=404}) _ _) ->
            err500{errBody = fromString $ unlines
                   [
                     "Error!",
                     "Bloc seems to be improperly configured (Strato pages are missing.)",
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
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
          DBError _ ->
            err500{errBody = fromString $ unlines
                   [
                     "Internal Error!",
                     "Something is broken in the Bloc Server database.", 
                     "Please contact your network administrator to have this problem fixed.",
                     "(More information can be found in the Bloc logs.)"
                   ]}
          UserError err -> err422{errBody = fromString $ show err}
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
    render
      = renderWithSeverity
      . renderWithCallStack
      . renderWithTimestamp
          (formatTime defaultTimeLocale rfc822DateFormat)

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
  conn <- asks dbConnection
  liftIO $ runQuery conn q

blocQuery1
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> Bloc y
blocQuery1 q = do
  traverse_ (logWithCallStack callStack logNotice . Text.pack) (showSql q)
  conn <- asks dbConnection
  results <- liftIO $ runQuery conn q
  case results of
    [] -> throwError $ DBError "No result, expected one row"
    [y] -> return y
    _:_:_ -> throwError $ DBError "Multiple results, expected one row"

blocModify :: HasCallStack => (Connection -> IO x) -> Bloc x
blocModify modify = do
  logWithCallStack callStack logNotice "Updating the database"
  conn <- asks dbConnection
  liftIO $ modify conn

blocModify1 :: HasCallStack => (Connection -> IO [x]) -> Bloc x
blocModify1 modify = do
  logWithCallStack callStack logNotice "Updating the database"
  conn <- asks dbConnection
  results <- liftIO $ modify conn
  case results of
    [] -> throwError $ DBError "No result, expected one row"
    [y] -> return y
    _:_:_ -> throwError $ DBError "Multiple results, expected one row"

blocTransaction :: Bloc x -> Bloc x
blocTransaction bloc = do
  conn <- asks dbConnection
  liftBaseOp_ (withTransaction conn) bloc

blocStrato :: HasCallStack => ClientM x -> Bloc x
blocStrato client' = do
  logWithCallStack callStack logNotice "Querying Strato"
  url <- asks urlStrato
  mngr <- asks httpManager
  resultEither <- liftIO $ runClientM client' (ClientEnv mngr url)
  either (throwError . StratoError) return resultEither

blocMaybe :: Text -> Maybe x -> Bloc x
blocMaybe msg = maybe (throwError (CouldNotFind msg)) return
