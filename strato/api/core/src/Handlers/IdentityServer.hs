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
-- import Network.Wai.Handler.Warp
import Servant
-- import Servant.API
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
-- import qualified IdentityProviderAPI as V
import           IdentityProviderClient

-- import Data.String.Conversions (ConvertibleStrings, convertString)
-- import Data.String (IsString)


type PostRedirect (code :: Nat) loc = Verb 'POST code '[JSON] (Headers '[Header "Location" loc] NoContent)


type API =  "identity" :> Header' '[Required, Strict] "X-USER-ACCESS-TOKEN" Text :>  PostRedirect 301 String

-- type API =  "identity" :>  PostRedirect 301 String


-- redirect :: ToHttpApiData loc 
--     => loc --  what to put in the 'Location' header
--     ->  (Headers '[Header "Location" loc] NoContent)
-- redirect a  = (addHeader a NoContent)

redirect :: ToHttpApiData loc 
    => loc --  what to put in the 'Location' header
    -> Text
    ->  (Headers '[Header "Location" loc] NoContent)
redirect a _ = (addHeader a NoContent)


-- identityPutRedirect :: (ToHttpApiData loc, Data.String.IsString loc) 
--         => Text ->  (Headers '[Header "Location" loc] NoContent)
-- identityPutRedirect _  = (redirect "http://localhost:8023")

--TODO make a import flag for this
server :: (MonadIO m) => ServerT API m
-- server =  return $ identityPutRedirect
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