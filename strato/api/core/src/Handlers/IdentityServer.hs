{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE ScopedTypeVariables    #-}
{-# LANGUAGE TemplateHaskell        #-}
{-# LANGUAGE FlexibleContexts       #-}
{-# LANGUAGE FlexibleInstances      #-}
{-# LANGUAGE MultiParamTypeClasses  #-}
{-# LANGUAGE OverloadedStrings      #-}
{-# LANGUAGE RecordWildCards        #-}
{-# LANGUAGE TypeApplications       #-}
{-# LANGUAGE TypeFamilies           #-}
{-# LANGUAGE TypeOperators          #-}
{-# LANGUAGE LambdaCase             #-}


module Handlers.IdentityServer (API, server, getCertAddress) where

import GHC.TypeLits
import Servant
import Control.Monad.IO.Class
import Data.Text

import           Blockchain.Strato.Model.Address
import           Control.Monad.Composable.Vault
import           Control.Monad.Change.Modify        (access)

import           Servant.Client
import           UnliftIO
import           BlockApps.Logging
import           GHC.Stack
import           SQLM
import           IdentityProviderClient

--TODO you may need to get a bit more funky with this return type
--Or this may not be need
--You may be able to call this from nginx and do the redirect in nginx as well
type PostRedirect (code :: Nat) loc = Verb 'POST code '[JSON] (Headers '[Header "Location" loc] NoContent)


type API =  "identity" :> Header' '[Required, Strict] "X-USER-ACCESS-TOKEN" Text :>  PostRedirect 301 String

redirect :: ToHttpApiData loc 
    => loc --  what to put in the 'Location' header
    -> Text
    ->  (Headers '[Header "Location" loc] NoContent)
redirect a _ = (addHeader a NoContent)

--TODO fix this port number to be an option
--TODO didn't call the identity provider client yet
server :: (MonadIO m) => ServerT API m
server =  return . (redirect "http://localhost:8023")

identitytWrapper :: (MonadIO m, MonadLogger m, HasIdentity m, HasCallStack) =>
                    ClientM x -> m x
identitytWrapper client' = do
  logInfoCS callStack "Querying Identity Wrapper"
  IdentityData url mgr <- access Proxy
  resultEither <-
    liftIO $ runClientM client' (mkClientEnv mgr url)
  either (blocError . IdentitytWrapperError) return resultEither

getCertAddress ::  (MonadLogger m, MonadUnliftIO m, HasIdentity m) => m Address
getCertAddress = identitytWrapper $ putIdentity "" "Nothing"