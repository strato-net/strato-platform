{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Main (main) where

-- import Data.Cache
import qualified Data.Text               as T
import VaultProxyLib
import HFlags
import Control.Exception
import Network.Wai

 
--Default is that the OAUTH is enabled



main :: IO ()
--initialize the vault proxy with the new flags
main = do 
    blockappsInit "vault-proxy"
    unless flags_OAUTH_ENABLED $ error "OAUTH is not enabled"

    forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering 
    putStrLn vaultProxyLogo

    --Initialize a new connection manager, ensure TLS communication as everything is sensitive info from here on out.
    mgr <- newManager tlsManagerSettings
    let vaultConnection = VaultConnection {
        vaultUrl = flags_VAULT_URL,
        vaultPassword = flags_VAULT_PASSWORD,
        vaultPort = flags_VAULT_PORT,
        httpManager = mgr,
        oauthEnabled = flags_OAUTH_ENABLED,
        oauthUrl = flags_OAUTH_DISCOVERY_URL,
        oauthClientId = flags_OAUTH_CLIENT_ID
        oauthClientSecret = flags_OAUTH_CLIENT_SECRET,
        oauthReserveSeconds = flags_OAUTH_RESERVE_SECONDS,
        oauthServiceClientId = flags_OAUTH_SERVICE_USER_CLIENT_ID,
        oauthServiceClientSecret = flags_OAUTH_SERVICE_USER_CLIENT_SECRET,
        vaultProxyUrl = flags_VAULT_PROXY_URL,
        vaultProxyPort = flags_VAULT_PROXY_PORT
    }
    _ <- $initHFlags "Vault Proxy"
    --check if the shared vault is alive
    -- unless (checkIfAlive vaultConnection ^. vaultUrl) $ error "The given shared vault is dead 💀"
    
    --Initialize the cache, make it able to use STM
    tokenCache <- atomically $ newCacheSTM Nothing


    --TODO: Check if the NGINX information is current and usable, use this info if avail, fall back to discovery URL from getting started script
    startUpScriptOauth <- case flags_OAUTH_DISCOVERY_URL of
        "" -> error "No OAuth2 Discovery URL was provided"
        url -> do
            ourl <- parseBaseUrl url
            rawOauthInfo <- runClientM connectRawOauth (mkClientEnv mgr ourl)
            case rawOAuthInfo of
                Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
                Right val -> return val
    --Pass the token into the awesome function, this will take care of everything and will return just the acess information
    madison <- liftIO $ getAwesomeToken initialCache clientId clientSecret reserveSeconds noErrorOauth
    race_ 
        --Run the prometheus metrics
        (run 10213 $ prometheus def vaultProxyApp)
        --Run the actual vault proxy
        (run (vaultConnection ^. vaultPort) vaultProxyApp)



appVaultProxy :: VaultConnection -> Application
appVaultProxy vaultConnection = serve VaultProxyAPI vaultProxyServer
-- appVaultProxy :: VaultConnection -> Application
-- appVaultProxy connexion = 
--     prometheus def{
--         prometheusEndPoint = ["strato", "vault-proxy", "metrics"],
--         prometheusInstrumentApp = False
--     }
--     . instrumentApp "vault-proxy"
--     . (if flags_minLogLevel == LevelDebug then logStdoutDev else logStdout)
--     . cors (const $ Just policy)
--     . provideOptions (Proxy @ VaultProxyAPI)
--     . serve (Proxy @ ("strato" :> "vault-proxy" :> VaultProxyAPI))
--     $ serverVaultProxy connexion
--         :<|> return vaultProxySwagger
--     where 
--         --TODO: ensure this is the most secure method of doing this
--         policy = simpleCorsResourcePolicy { corsRequestHeaders = ["Content-Type"]}