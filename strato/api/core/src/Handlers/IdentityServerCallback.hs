{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-redundant-constraints       #-}

module Handlers.IdentityServerCallback (API, server) where

import BlockApps.Logging
import Blockchain.Strato.Model.Address
import Control.Exception (SomeException, try)
import Control.Monad.Change.Modify (access)
import Control.Monad.Composable.Identity
import Control.Monad.IO.Class
import Control.Monad.Reader (runReaderT)
import Data.Text
import GHC.Stack
import GHC.TypeLits
import IdentityProvider.Client
import SQLM
import SelectAccessible ()
import Servant
import Servant.Client

type PostRedirect (code :: Nat) loc = Verb 'GET code '[JSON] (Headers '[Header "Location" loc] Address)

type API =
  "identity"
    :> Header' '[Required, Strict] "X-USER-ACCESS-TOKEN" Text
    :> PostRedirect 302 String

server :: (MonadIO m, MonadLogger m, HasIdentity m) => ServerT API m
server = return =<< redirect

redirect ::
  (MonadIO m, MonadLogger m, HasIdentity m) =>
  Text ->
  m (Headers '[Header "Location" String] Address)
redirect accessToken = do
  IdentityData url mgr <- access Proxy
  --Historical note: we decided to wait for ID serer response, but ignore any bad response
  --As the fail safe should catch any ID server failure
  -- ?subscribe=true <-> Just True 
  idServerResult <- liftIO $ (try (runLoggingT $ (flip runReaderT (IdentityData url mgr) $ identitytWrapper $ putIdentityExternal ("Bearer " <> accessToken) (Just True))) :: IO (Either SomeException Address)) 
  case idServerResult of
    Left e -> do
      logErrorCS callStack $ "Error calling Identity Server: " <> pack (show e)
    Right _ -> do
      logInfoCS callStack "Successfully called Identity Server"
  return $ addHeader "/" (Address 0x0) --At one point we wanted to redirect with an address, but we don't need to do that anymore, maybe we should remove the address from the type signature

identitytWrapper ::
  (MonadIO m, MonadLogger m, HasIdentity m, HasCallStack) =>
  ClientM x ->
  m x
identitytWrapper client' = do
  logInfoCS callStack "Calling Identity Server"
  IdentityData url mgr <- access Proxy
  resultEither <- liftIO $ runClientM client' (mkClientEnv mgr url) -- Todo make a better error statement
  either (blocError . IdentitytWrapperError) return resultEither
