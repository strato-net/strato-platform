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

module Handlers.IdentityServerCallback (API, server) where


import           Data.Text
import           GHC.TypeLits
import           GHC.Stack
import           Servant
import           Servant.Client
import           Control.Monad.IO.Class

import           Control.Monad.Change.Modify        (access)
import           Control.Monad.Composable.Identity
import           SQLM

import           BlockApps.Logging
import           Blockchain.Strato.Model.Address
import           IdentityProvider.Client

type PostRedirect (code :: Nat) loc = Verb 'GET code '[JSON] (Headers '[Header "Location" loc] Address)

type API =  "identity" 
          :> Header' '[Required, Strict] "X-USER-ACCESS-TOKEN" Text
          :>  PostRedirect 301 String

redirect :: ( MonadIO m, MonadLogger m, HasIdentity m)
    => Text ->  m (Headers '[Header "Location" String] Address)
redirect accessToken = do
  address <- getUserAddress accessToken
  return $ addHeader "/" address

server :: (MonadIO m, MonadLogger m, HasIdentity m) => ServerT API m
server =  return =<< redirect 

identitytWrapper :: (MonadIO m, MonadLogger m, HasIdentity m, HasCallStack) =>
                    ClientM x -> m x
identitytWrapper client' = do
  logInfoCS callStack "Calling Identity Server"
  IdentityData url mgr <- access Proxy
  resultEither <-
    liftIO $ runClientM client' (mkClientEnv mgr url)-- Todo make a better error statement
  either (blocError . IdentitytWrapperError) return resultEither

getUserAddress ::  (MonadIO m, MonadLogger m, HasIdentity m) => Text -> m Address
getUserAddress accessToken = identitytWrapper $ putIdentityExternal ("Bearer " <> accessToken)