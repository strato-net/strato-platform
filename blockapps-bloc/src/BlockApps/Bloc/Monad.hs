{-# LANGUAGE
    GeneralizedNewtypeDeriving
#-}

module BlockApps.Bloc.Monad where

import Control.Monad.Except
import Control.Monad.Log
import Control.Monad.Reader
import Servant
import Text.PrettyPrint.Leijen.Text

newtype Bloc x = Bloc
  { runBloc ::
      ReaderT BlocEnv
        ( LoggingT (WithSeverity Doc)
          ( ExceptT ServantErr IO )
        ) x
  } deriving
  ( Functor
  , Applicative
  , Monad
  , MonadIO
  , MonadReader BlocEnv
  , MonadError ServantErr
  , MonadLog (WithSeverity Doc)
  )

data BlocEnv
