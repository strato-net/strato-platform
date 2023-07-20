{-# LANGUAGE DeriveGeneric          #-}
{-# LANGUAGE DeriveAnyClass         #-}
{-# LANGUAGE DataKinds              #-}
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
{-# OPTIONS -fno-warn-orphans       #-}

module Handlers.IdentityServer (API, server, getCertAddress) where


import           Data.Text
import           GHC.TypeLits
import           GHC.Stack
import           Servant
import           Servant.Client
import           Control.Monad.IO.Class

import           Control.Monad.Change.Modify        (access)
import           Control.Monad.Composable.Vault
import           SQLM

import           BlockApps.Logging
import           Blockchain.Strato.Model.Address
import           IdentityProviderClient

type PostRedirect (code :: Nat) loc = Verb 'GET code '[JSON] (Headers '[Header "Location" loc] Address)

type API =  "identity" 
          :> Header' '[Required, Strict] "X-USER-ACCESS-TOKEN" Text
          :>  PostRedirect 301 String

redirect :: (ToHttpApiData loc, MonadIO m, MonadLogger m, HasIdentity m)
    => loc --  what to put in the 'Location' header
    -> Text
    ->  m (Headers '[Header "Location" loc] Address)
redirect a accessToken = do
  address <- getCertAddress accessToken
  return $ (addHeader a address)

server :: (MonadIO m, MonadLogger m, HasIdentity m) => ServerT API m
server =  return =<< (redirect "http://localhost:8080") -- TODO fix this port number to be an option

identitytWrapper :: (MonadIO m, MonadLogger m, HasIdentity m, HasCallStack) =>
                    ClientM x -> m x
identitytWrapper client' = do
  logInfoCS callStack "Calling Identity Server"
  IdentityData url mgr <- access Proxy
  resultEither <-
    liftIO $ runClientM client' (mkClientEnv mgr url)-- Todo make a better error statement
  either (blocError . IdentitytWrapperError) return resultEither

getCertAddress ::  (MonadIO m, MonadLogger m, HasIdentity m) => Text -> m Address
getCertAddress accessToken = identitytWrapper $ putIdentityExternal ("Bearer " <> accessToken) "" -- I have a feeling Nikita will not approve of this and he is right