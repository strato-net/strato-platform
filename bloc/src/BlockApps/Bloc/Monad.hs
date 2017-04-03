{-# LANGUAGE
    FlexibleContexts
  , GeneralizedNewtypeDeriving
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeFamilies
#-}

module BlockApps.Bloc.Monad where

import Control.Monad.Base
import Control.Monad.Except
import Control.Monad.Log hiding (Handler)
import Control.Monad.Reader
import Control.Monad.Trans.Control
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import Data.Foldable
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Time.Format
import Database.PostgreSQL.Simple (Connection,withTransaction)
import Data.Profunctor.Product.Default
import GHC.Stack
import Network.HTTP.Client
import Opaleye
import Servant
import Servant.Client
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

enterBloc :: BlocEnv -> Bloc x -> Handler x
enterBloc env x
  = Handler
  $ withExceptT (\err -> err500{errBody = Lazy.Char8.pack (show err)})
  $ flip runLoggingT (liftIO . print . render Leijen.textStrict)
  $ flip runReaderT env $ runBloc x
  where
    -- render :: _
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
