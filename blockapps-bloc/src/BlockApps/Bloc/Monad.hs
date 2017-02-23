{-# LANGUAGE
    GeneralizedNewtypeDeriving
#-}

module BlockApps.Bloc.Monad where

import Control.Monad.Except
import Control.Monad.Log
import Control.Monad.Reader
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import Hasql.Connection
import Hasql.Session
import Network.HTTP.Client
import Servant
import Servant.Client
import Text.PrettyPrint.Leijen.Text

newtype Bloc x = Bloc
  { runBloc ::
      ReaderT BlocEnv -- global immutable environment variable
        ( LoggingT (WithSeverity Doc) -- log all the things
          ( ExceptT BlocError IO ) -- throw and catch errors
        ) x
  } deriving
  ( Functor
  , Applicative
  , Monad
  , MonadIO
  , MonadReader BlocEnv
  , MonadError BlocError
  , MonadLog (WithSeverity Doc)
  )

data BlocEnv = BlocEnv
  { urlStrato :: BaseUrl
  , httpManager :: Manager
  , dbConnection :: Connection
  }

data BlocError
  = DBError Error
  | StratoError ServantError
  deriving Show

enterBloc :: BlocEnv -> Bloc x -> ExceptT ServantErr IO x
enterBloc env x
  = withExceptT (\err -> err500{errBody = Lazy.Char8.pack (show err)})
  $ flip runLoggingT (liftIO . print)
  $ flip runReaderT env $ runBloc x

runHasql :: Session x -> Bloc x
runHasql session = do
  conn <- asks dbConnection
  resultEither <- liftIO $ run session conn
  either (throwError . DBError) return resultEither
