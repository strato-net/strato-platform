{-# LANGUAGE
    GeneralizedNewtypeDeriving
#-}

module BlockApps.Bloc.Monad where

import Control.Monad.Except
import Control.Monad.Log hiding (Handler)
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

enterBloc :: BlocEnv -> Bloc x -> Handler x
enterBloc env x
  = Handler
  $ withExceptT (\err -> err500{errBody = Lazy.Char8.pack (show err)})
  $ flip runLoggingT (liftIO . print)
  $ flip runReaderT env $ runBloc x

blocSql :: Session x -> Bloc x
blocSql session = do
  conn <- asks dbConnection
  resultEither <- liftIO $ run session conn
  either (throwError . DBError) return resultEither

blocStrato :: ClientM x -> Bloc x
blocStrato client = do
  url <- asks urlStrato
  mngr <- asks httpManager
  resultEither <- liftIO $ runClientM client (ClientEnv mngr url)
  either (throwError . StratoError) return resultEither
