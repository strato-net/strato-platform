{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TypeApplications  #-}

module Lib 
    ( identityProviderApp
    )
where

import           Servant

import           Data.Text (Text)
import           Blockchain.Strato.Model.Address (Address(..))


type MakeCert = "cert" -- what headers to include?
              :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
              :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER" Text
              :> Post '[JSON] Address --should return cert address

type IdentityProviderAPI = MakeCert --only 1 endpoint

makeCert :: Text -> Text -> Handler Address
makeCert _ _ = return $ Address 0x509

identityProviderServer :: Server IdentityProviderAPI
identityProviderServer = makeCert

identityProviderApp :: Application
identityProviderApp = serve (Proxy @IdentityProviderAPI) identityProviderServer
