{-# LANGUAGE
    FlexibleContexts
  , GeneralizedNewtypeDeriving
  , OverloadedStrings
#-}

module BlockApps.Bloc.Monad where

import Control.Exception (Exception)
import Control.Monad.Except
import Control.Monad.Log hiding (Handler)
import Control.Monad.Reader
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import Data.Text (Text)
import Database.PostgreSQL.Simple (Connection,withTransaction)
import Data.Profunctor.Product.Default
import Network.HTTP.Client
import Opaleye
import Servant
import Servant.Client

newtype Bloc x = Bloc
  { runBloc ::
      ReaderT BlocEnv -- global immutable environment variable
        ( LoggingT (WithSeverity Text) -- log all the things
          ( ExceptT BlocError IO ) -- throw and catch errors
        ) x
  } deriving
  ( Functor
  , Applicative
  , Monad
  , MonadIO
  , MonadReader BlocEnv
  , MonadError BlocError
  , MonadLog (WithSeverity Text)
  )

data BlocEnv = BlocEnv
  { urlStrato :: BaseUrl
  , httpManager :: Manager
  , dbConnection :: Connection
  }

data BlocError
  = StratoError ServantError
  | DBError Text
  | UserError Text
  deriving Show

instance Exception BlocError where

enterBloc :: BlocEnv -> Bloc x -> Handler x
enterBloc env x
  = Handler
  $ withExceptT (\err -> err500{errBody = Lazy.Char8.pack (show err)})
  $ flip runLoggingT (liftIO . print)
  $ flip runReaderT env $ runBloc x

blocQuery :: Default QueryRunner x y => Query x -> Bloc [y]
blocQuery q = do
  conn <- asks dbConnection
  liftIO . withTransaction conn $ runQuery conn q

blocQuery1 :: Default QueryRunner x y => Query x -> Bloc y
blocQuery1 q = do
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

blocStrato :: ClientM x -> Bloc x
blocStrato client' = do
  url <- asks urlStrato
  mngr <- asks httpManager
  resultEither <- liftIO $ runClientM client' (ClientEnv mngr url)
  either (throwError . StratoError) return resultEither
