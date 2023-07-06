{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE DeriveGeneric #-}

module Lib 
    ( identityProviderApp
    )
where

import           Servant

import           Data.Text (Text)
import           Blockchain.Strato.Model.Address (Address(..))

newtype OAuthUserAttributes = OAuthUserAttributes {companyName :: !Maybe Text} deriving (Show, Generic)
data OAuthUser = OAuthUser {
    firstName   :: !Text,
    lastName    :: !Text,
    attributes  :: !Maybe OAuthUserAttributes
} deriving (Show, Generic)


type MakeCert = "cert" -- what headers to include? -> shouwl be X-ACCESS-USER-TOKEN
              :> Header' '[Required, Strict] "Authorization" Text -- parse this as JWT -> get 'sub' field for user's uuid
              :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
              :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER" Text
              :> Post '[JSON] Address --should return cert address
--realm name should be parameter
--root cert just files on server's file system (flag to point to files)
--ask Zach where storing org name and common name on keycloak (attribute?)
--use makeSignedCert function (or refactor the x509-gen tool)
--add client binding to tx endpoint (then call it)
--node url should also be a param
type IdentityProviderAPI = MakeCert --only 1 endpoint

-- use vault client bindings
makeCert :: Text -> Text -> Handler Address
makeCert _ _ = return $ Address 0x509

identityProviderServer :: Server IdentityProviderAPI
identityProviderServer = makeCert

identityProviderApp :: Application
identityProviderApp = serve (Proxy @IdentityProviderAPI) identityProviderServer
