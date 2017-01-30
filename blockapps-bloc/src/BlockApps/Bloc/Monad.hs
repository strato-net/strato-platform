{-# LANGUAGE
    GeneralizedNewtypeDeriving
#-}

module BlockApps.Bloc.Monad where

import Control.Monad.Except
import Control.Monad.Log
import Control.Monad.Reader
import Hasql.Connection
import Hasql.Session
import Network.HTTP.Client
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
