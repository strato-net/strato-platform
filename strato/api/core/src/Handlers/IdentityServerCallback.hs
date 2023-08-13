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
{-# OPTIONS -fno-warn-redundant-constraints       #-}

module Handlers.IdentityServerCallback (API, server) where


import           Data.Text
import           GHC.TypeLits
import           GHC.Stack
import           Servant
import           Servant.Client
import           Control.Monad.Reader              (runReaderT)
import           Control.Exception                 (try, SomeException)
import           Control.Monad.IO.Class


import           Control.Monad.Change.Modify        (access)
import           Control.Monad.Composable.Identity
import           SelectAccessible                   ()
import           SQLM

import           BlockApps.Logging
import           Blockchain.Strato.Model.Address
import           IdentityProvider.Client

type PostRedirect (code :: Nat) loc = Verb 'GET code '[JSON] (Headers '[Header "Location" loc] Address)

type API =  "identity" 
          :> Header' '[Required, Strict] "X-USER-ACCESS-TOKEN" Text
          :>  PostRedirect 302 String

server :: (MonadIO m, MonadLogger m, HasIdentity m) => ServerT API m
server =  return =<< redirect 

redirect :: ( MonadIO m, MonadLogger m, HasIdentity m)
    => Text ->  m (Headers '[Header "Location" String] Address)
redirect accessToken = do
  IdentityData url mgr <- access Proxy
  --Historical note: we decided to wait for ID serer response, but ignore any bad response
  --As the fail safe should catch any ID server failure
  _ <- liftIO $ (try (runLoggingT $ (flip runReaderT ( IdentityData url mgr)  $ identitytWrapper $ putIdentityExternal ("Bearer " <> accessToken) )) :: IO (Either SomeException Address) )
  return $ addHeader "/" (Address 0x0) --At one point we wanted to redirect with an address, but we don't need to do that anymore, maybe we should remove the address from the type signature

identitytWrapper :: (MonadIO m, MonadLogger m, HasIdentity m, HasCallStack) =>
                    ClientM x -> m x
identitytWrapper client' = do
  logInfoCS callStack "Calling Identity Server"
  IdentityData url mgr <- access Proxy
  resultEither <- liftIO $ runClientM client' (mkClientEnv mgr url) -- Todo make a better error statement
  either (blocError . IdentitytWrapperError) return resultEither