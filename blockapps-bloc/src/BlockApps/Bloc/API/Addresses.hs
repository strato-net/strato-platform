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
import qualified Data.ByteString.Char8 as Char8
import Data.Maybe
import Data.Proxy
import qualified Hasql.Decoders as Decoders
import qualified Hasql.Encoders as Encoders
import Hasql.Query
import Hasql.Session
import Servant.API
import Servant.Client
import Servant.Docs

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Data

class Monad m => MonadAddresses m where
  getAddresses :: m [Address]
  getAddressesPending :: Address -> m NoContent
  getAddressesPendingRemove :: Address -> Int -> m NoContent
instance MonadAddresses ClientM where
  getAddresses = client (Proxy @ GetAddresses)
  getAddressesPending = client (Proxy @ GetAddressesPending)
  getAddressesPendingRemove = client (Proxy @ GetAddressesPendingRemove)
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
      Right addresses -> return (catMaybes addresses)
  getAddressesPending = undefined
  getAddressesPendingRemove = undefined

type GetAddresses = "addresses" :> Get '[HTMLifiedJSON] [Address]

-- GET /addresses/:address/pending
type GetAddressesPending = "addresses"
  :> Capture "address" Address
  :> "pending"
  :> Get '[JSON] NoContent

-- GET /addresses/:address/pending/remove/:time
type GetAddressesPendingRemove = "addresses"
  :> Capture "address" Address
  :> "pending"
  :> "remove"
  :> Capture "time" Int
  :> Get '[JSON] NoContent
instance ToCapture (Capture "time" Int) where
  toCapture _ = DocCapture "time" "a unix timestamp"

addressDecoder :: Decoders.Value (Maybe Address)
addressDecoder = stringAddress . Char8.unpack <$> Decoders.bytea
