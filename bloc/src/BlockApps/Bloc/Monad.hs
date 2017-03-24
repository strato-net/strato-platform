{-# LANGUAGE
    FlexibleContexts
  , GeneralizedNewtypeDeriving
  , MultiParamTypeClasses
  , OverloadedStrings
#-}

module BlockApps.Bloc.Monad where

import Control.Monad.Except
import Control.Monad.Log hiding (Handler)
import Control.Monad.Reader
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import Data.Foldable
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Time.Format
import Database.PostgreSQL.Simple (Connection,withTransaction)
import Data.Profunctor.Product.Default
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
  , MonadReader BlocEnv
  , MonadLog (WithSeverity (WithCallStack (WithTimestamp Text)))
  )

instance MonadError BlocError Bloc where
  throwError err = do
    logError . withCallStack =<< timestamp (Text.pack (show err))
    Bloc $ throwError err
  catchError m handle = do
    logError . withCallStack =<< timestamp "catching error"
    Bloc $ catchError (runBloc m) (runBloc . handle)

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
  | Unimplemented
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

blocQuery
  :: (Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> Bloc [y]
blocQuery q = do
  for_ (showSql q) $ \ sql ->
    logNotice . withCallStack =<< timestamp (Text.pack sql)
  conn <- asks dbConnection
  liftIO . withTransaction conn $ runQuery conn q

blocQuery1
  :: (Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> Bloc y
blocQuery1 q = do
  for_ (showSql q) $ \ sql ->
    logNotice . withCallStack =<< timestamp (Text.pack sql)
  conn <- asks dbConnection
  results <- liftIO . withTransaction conn $ runQuery conn q
  case results of
    [] -> throwError $ DBError "No result, expected one row"
    [y] -> return y
    _:_:_ -> throwError $ DBError "Multiple results, expected one row"

blocModify :: (Connection -> IO x) -> Bloc x
blocModify modify = do
  conn <- asks dbConnection
  liftIO $ withTransaction conn (modify conn)

blocModify1 :: (Connection -> IO [x]) -> Bloc x
blocModify1 modify = do
  conn <- asks dbConnection
  results <- liftIO $ withTransaction conn (modify conn)
  case results of
    [] -> throwError $ DBError "No result, expected one row"
    [y] -> return y
    _:_:_ -> throwError $ DBError "Multiple results, expected one row"

blocStrato :: ClientM x -> Bloc x
blocStrato client' = do
  url <- asks urlStrato
  mngr <- asks httpManager
  resultEither <- liftIO $ runClientM client' (ClientEnv mngr url)
  either (throwError . StratoError) return resultEither

blocMaybe :: Text -> Maybe x -> Bloc x
blocMaybe msg = maybe (throwError (CouldNotFind msg)) return
