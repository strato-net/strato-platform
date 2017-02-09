{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API.Addresses where

import Control.Monad.Except
import Control.Monad.Reader
import Data.Proxy
import qualified Hasql.Decoders as Decoders
import qualified Hasql.Encoders as Encoders
import Hasql.Query
import Hasql.Session
import Servant.API
import Servant.Client

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Data

class Monad m => MonadAddresses m where
  getAddresses :: m [Address]
instance MonadAddresses ClientM where
  getAddresses = client (Proxy @ GetAddresses)
instance MonadAddresses Bloc where
  getAddresses = do
    conn <- asks dbConnection
    let
      addressesQuery = statement
        "SELECT address from addresses;"
        Encoders.unit
        (Decoders.rowsList (Decoders.value addressDecoder))
        False
    addressesEither <- liftIO $ run (query () addressesQuery) conn
    case addressesEither of
      Left err -> throwError $ DBError err
      Right addresses -> return addresses

type GetAddresses = "addresses" :> Get '[HTMLifiedJSON] [Address]
