{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module VaultProxy
    ( getAllUserData
    -- , getPing
    -- , postKey
    -- , getKey
    -- , getSharedKey
    -- , getUsers
    -- , postSignature
    -- , postPassword
    -- , verifyPassword
    -- , getNonce
    -- , postNewUser
    -- , removeUsersInOrg
    ) where

import Control.Concurrent.STM
import Data.Cache
import Data.Text
import Data.Time (UTCTime)
import Data.Lenses
import Servant.API
import Servant.Auth.JWT
import Network.OAuth.OAuth2


-- type UserAccessToken = "accessToken" 
--     :> Header "Content-Type: application/x-www-form-urlencoded" Text 
--     :> Header authy Authorization :> Post '[JSON] AccessToken

--TODO: make sure that all of the types are correct
-- data SuperVaultData = SuperVaultData {
--     _xUserUniqueName :: String,
--     _salt :: String,
--     _nonce :: String,
--     _encSecKey :: String,
--     _encSecPrivKey :: String,
--     _address :: String,
--     _node_id :: String,
--     _oauth_provider_id :: String,
-- } deriving (Eq, Show)
-- makeLenses ''SuperVaultData

-- data RawToken = RawToken {
--     --TODO::
--     stuff :: String
-- } deriving (Eq, Show)

--TODO: Make all of the items begin at boot, rather than everytime it is initialized (In other words have a cache)
getAccessToken :: OAuth2Token 
getAccessToken manager oauth exchange = do
    accessToken <- atomically $ newTVar (fetchAccessToken manager oauth exchange)
    -- fetchAccessToken 
    -- --ClientAuthenticationMethod
    -- --Manager (use the same Manager as currently employed in the VaultWrapperEnv, should add `newManager defaultManagerSettings` at boot time not everytime the function is called)
    -- (Manager newManager defaultManagerSettings)
    -- --OAuth2
    -- (OAuth2 
    --     --This is the operator that actually provides the client information
    --     "dev"
    --     --This is secret
    --     "d5e67b8c-4fbf-42c6-a8d9-29a4dd13575f"
    --     --This is where the actual information for the website is, this is where the oauth should look url wise`
    --     (parseURI strictURIParserOptions "https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration" )
    --     --This is the resulting url that is actually getting the information, this is largely wanted to ensure that that there isn't a man in the middle attack
    --     -- //oauth2TokenEndpoint 
    --     --I think this part is optional but it redirects the user to something so they can finish logging in, so something like a 2FA situation.
    --     -- //oauth2RedirectUri)
    -- --ExchangeToken
    -- (ExchangeToken exchangeToken)

getAllUserData :: SuperVaultData

getPing :: String

getKey :: AddressAndKey

postKey :: AddressAndKey

getSharedKey :: SharedKey

getUsers :: [User]

postSignature :: Signature

postPassword :: ClientM 

verifyPassword :: Bool