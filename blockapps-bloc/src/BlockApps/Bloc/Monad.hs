{-# LANGUAGE
    GeneralizedNewtypeDeriving
#-}

module BlockApps.Bloc.Monad where

import Control.Monad.Except
import Control.Monad.Log
import Control.Monad.Reader
import Text.PrettyPrint.Leijen.Text

newtype Bloc x = Bloc
  { runBloc ::
      ReaderT BlocEnv
        ( LoggingT (WithSeverity Doc)
          (ExceptT BlocError IO)
        ) x
  } deriving
  ( Functor
  , Applicative
  , Monad
  , MonadReader BlocEnv
  , MonadError BlocError
  , MonadLog (WithSeverity Doc)
  )

data BlocEnv
data BlocError
