{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Main (main) where

-- import BlockApps.Init
-- import Control.Monad
-- import Control.Monad.IO.Class
-- import Data.ByteString                   as BS
-- import Data.ByteString.UTF8              (toString)
-- import Data.Cache
import qualified Data.Text               as T
-- import Debug.Trace
-- import VaultProxyLib
import HFlags
-- import Control.Concurrent
-- import Control.Concurrent.STM
-- import Control.Lens
-- import Network.HTTP.Client
-- import Network.HTTP.Conduit
-- import Servant
-- import Servant.Client
-- import URI.ByteString
-- import Servant.Client.Core

 
--Default is that the OAUTH is enabled
defineFlag "OAUTH_ENABLED" (True :: Bool) "Enable OAuth2"
defineFlag "OAUTH_DISCOVERY_URL" ("" :: T.Text) "OAuth2 Discovery URL"
defineFlag "OAUTH_JWT_USERNAME_PROPERTY" ("" :: T.Text) "OAuth2 JWT Username Property"
defineFlag "OAUTH_CLIENT_ID" ("" :: T.Text) "OAuth2 Client ID"
defineFlag "OAUTH_CLIENT_SECRET" ("" :: T.Text) "OAuth2 Client Secret"
defineFlag "OAUTH_RESERVE_SECONDS" (13 :: Int) "How long the system should reserve for the token to expire, default is 13 seconds."
defineFlag "VAULT_URL" ("" :: T.Text) "The place where I go to visit THE VAULT 🔒."
defineFlag "VAULT_PORT" (1313 :: Int) "This is the place that the vault proxy will attempt to connect and will also communicate with. Same port is used for post and gets, just to let you know."
defineFlag "VAULT_PASSWORD" ("" :: T.Text) "This is the password that is used to log into the shared vault."

main :: IO ()
--initialize the vault proxy with the new flags
main = do 
    pure undefined
    -- blockappsInit "vault-proxy"
    -- _ <- $initHFlags "Vault Proxy"
    --Throw error when the OAUTH is not enabled, not totally sure what to do when that happens
    -- unless flags_OAUTH_ENABLED $ error "OAUTH is not enabled"
    -- --open a new network manager connection as we are in a new executable
    -- --ntmgr <- newManager defaultManagerSettings
    -- --Make an STM variable to allow for many processes to obtain the same token
    -- --Store the raw oauthToken, not just the access token
    -- mngr <- newManager tlsManagerSettings --Not sure if this is the right manager due to large use of HTTPS connections
    -- -- extraTokenStuff :: [ (ByteString, ByteString) ]
    -- -- let extraTokenStuff :: BlockAppsTokenRequest
    --     -- extraTokenStuff = [("grant_type", flags_oidcGrantType)]
    -- -- url <- (parseBaseUrl $ T.unpack flags_oidcUrl)
    -- ourl <- (parseBaseUrl $ T.unpack flags_OAUTH_DISCOVERY_URL)
    -- rawOauthInfo <- runClientM connectRawOauth (mkClientEnv mngr ourl)
    -- noErrorOauth <- case rawOauthInfo of
    --     Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
    --     Right val -> return val

    -- virginToken <- getVirginToken mngr flags_OAUTH_CLIENT_ID flags_OAUTH_CLIENT_SECRET noErrorOauth --Might decide to add flags_OAUTH_DISCOVERY_URL back to the mix later
    -- --Save the access token in a TVar
    -- traceM "virgin"
    -- traceShowM virginToken 
        -- res <- runClientM 
        --         (connectToken flags_oidcUrl flags_oidcAuthorization extraTokenStuff)
        --         (mkClientEnv mngr url)
        -- print res
    -- oauthTokenWithTime <- atomically $ newTVar (
    --     runClientM 
    --         (connectToken flags_oidcUrl flags_oidcAuthorization extraTokenStuff)
    --         (mkClientEnv mngr (parseBaseUrl flags_oidcUrl))
    -- ) 

    -- (getVirginToken $ parseBaseUrl flags_OAUTH_DISCOVERY_URL)


-- main :: IO ()
-- main = do
--   (x:xs) <- getArgs
--   manager' <- newManager tlsManagerSettings
--   res <- runClientM (queries (T.pack x)) (mkClientEnv manager' (BaseUrl Https "content.guardianapis.com" 443 ""))
--   print res

--Get the first connection for the OAUTH information
-- const CACHED_DATA = {
--   serviceToken: null,
--   serviceTokenExpiresAt: null,
-- }

-- const getServiceToken = async () => {
--   let token = CACHED_DATA.serviceToken
--   const expiresAt = CACHED_DATA.serviceTokenExpiresAt
--   if (
--     !token
--     || !expiresAt
--     || expiresAt
--       <= Math.floor(Date.now() / 1000)
--         + constants.tokenLifetimeReserveSeconds
--   ) {
--     const tokenObj = await oauth.getAccessTokenByClientSecret()       // (here is where you need to do that HTTP request to /token endpoint instead with base64 Basic token in Authorization header) 
--     token = tokenObj.token[
--       config.nodes[0].oauth.tokenField
--         ? config.nodes[0].oauth.tokenField
--         : 'access_token'
--     ]
--     CACHED_DATA.serviceToken = token
--     CACHED_DATA.serviceTokenExpiresAt = Math.floor(
--       tokenObj.token.expires_at / 1000,
--     )
--   }
--   return token
-- }



-- getToken :: STM TVar VaultToken -> VaultToken          
-- getToken oldToken = do
--   --Check if the token is expired
--   if (input ^. accessTokenExpiresIn) < 0 then
--     --If it is expired, refresh the token
    
--   else
--     --If it isn't expired, return the token
--     return input


