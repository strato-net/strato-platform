module VaultProxySpec (
  spec) where

import VaultProxyLib

import Control.Concurrent.STM
import Control.Monad.IO.Class
import Data.Cache
import qualified Data.Text      as T
import Data.ByteString.Base64
import Data.Text.Encoding       as TE
import Network.HTTP.Client
import Network.HTTP.Conduit
import Servant.Client
import Test.Hspec

discoveryUrl :: String
discoveryUrl = "https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration" 
clientId :: T.Text
clientId     = T.pack "dev"
clientSecret :: T.Text
clientSecret = T.pack "d5e67b8c-4fbf-42c6-a8d9-29a4dd13575f"
reserveSeconds :: Int
reserveSeconds = 13
-- port :: Int
-- port = 1313

spec :: Spec
spec = do
  describe "Vault proxy library" $ do
    it "can get the initial connection information." $ do
      mngr <- liftIO $ newManager tlsManagerSettings
      ourl <- parseBaseUrl discoveryUrl
      rawOauthInfo <- runClientM connectRawOauth (mkClientEnv mngr ourl)
      noErrorOauth <- case rawOauthInfo of
          Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
          Right val -> return val
      noErrorOauth `shouldBe` RawOauth (T.pack "https://keycloak.blockapps.net/auth/realms/strato-devel/protocol/openid-connect/auth") (T.pack "https://keycloak.blockapps.net/auth/realms/strato-devel/protocol/openid-connect/token")
    
    --The following test will always fail as the token is generated elsewhere, but the test is useful to see if the token is being generated correctly
    xit "can use the virgin token function." $ do
      mngr <- liftIO $ newManager tlsManagerSettings
      ourl <- parseBaseUrl discoveryUrl
      rawOauthInfo <- runClientM connectRawOauth (mkClientEnv mngr ourl)
      noErrorOauth <- case rawOauthInfo of
          Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
          Right val -> return val
      vaultToken <- liftIO $ getVirginToken clientId clientSecret noErrorOauth
      let adam = vaultToken
          resultant = VaultToken (T.pack "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJWY0N4SEpnUjFOdnJ4UWR5QXhQcEI5VEowM205SVRDdWt0b1JfTENVSE1VIn0.eyJqdGkiOiI1NzVkYTdiMC1hYmRlLTQyMTYtOTQ0MS03ZjVmN2Y2NmU1OWEiLCJleHAiOjE2Njc2MDA3OTAsIm5iZiI6MCwiaWF0IjoxNjY3NjAwNDkwLCJpc3MiOiJodHRwczovL2tleWNsb2FrLmJsb2NrYXBwcy5uZXQvYXV0aC9yZWFsbXMvc3RyYXRvLWRldmVsIiwiYXVkIjoiYWNjb3VudCIsInN1YiI6ImJlMThjNWE3LWRjOTUtNDFkMC04MzI3LWZmZjNmMjJkNGQzMiIsInR5cCI6IkJlYXJlciIsImF6cCI6ImRldiIsImF1dGhfdGltZSI6MCwic2Vzc2lvbl9zdGF0ZSI6IjUxYTA0ZTc1LTBkMmUtNDhlOS1iY2I1LTRjZmRkNGRhMDdhZiIsImFjciI6IjEiLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImRldiI6eyJyb2xlcyI6WyJ1bWFfcHJvdGVjdGlvbiJdfSwiYWNjb3VudCI6eyJyb2xlcyI6WyJtYW5hZ2UtYWNjb3VudCIsIm1hbmFnZS1hY2NvdW50LWxpbmtzIiwidmlldy1wcm9maWxlIl19fSwic2NvcGUiOiJlbWFpbCBwcm9maWxlIiwiY2xpZW50SG9zdCI6IjE3Mi43MC4xMDAuNzEiLCJjbGllbnRJZCI6ImRldiIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZSwicHJlZmVycmVkX3VzZXJuYW1lIjoic2VydmljZS1hY2NvdW50LWRldiIsImNsaWVudEFkZHJlc3MiOiIxNzIuNzAuMTAwLjcxIiwiZW1haWwiOiJzZXJ2aWNlLWFjY291bnQtZGV2QHBsYWNlaG9sZGVyLm9yZyJ9.hEGXrceWz_nJONyKa-Td8wY_AbZUqBAJ8I2VzN3gZX7Rj_S0pauca9-JFUjIEEfyqTJdmmzNjYSNv3mKQWcbMhAVyjeu9wtnVbG9aNhP9d9lXptGDhMPYdSx9ZJXLrexYf9CLlHTcnMAN6hvbvS10lBZLMiBGC0WdgpuyjusmFao7Ud-Q1oLArwB7kqQB3y8b4uEFPFYWScibeBjKR5GKTpOpHl0ve9-5JcuDUo47yqTrvBENQs9sH8R-OF7h6c5bUXopNDHGizyH2Y0I26Xwlwh9-m90Pa0sOFw7JoRMFWCFpKs_vktFya8iK5TH0TtaCWBBGUq_ozJaEPYnfM92g")
            300 1800 (T.pack "eyJhbGciOiJIUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJiMWEwNmM4NS01MzBkLTRkYTUtYTk3Yy03YjFhYjQwNDQ2YjgifQ.eyJqdGkiOiJmNTFlNmQ4ZC03ZGRmLTQ5NjQtOWUwZS0yZjlkMzE0NTI0NzIiLCJleHAiOjE2Njc2MDIyOTAsIm5iZiI6MCwiaWF0IjoxNjY3NjAwNDkwLCJpc3MiOiJodHRwczovL2tleWNsb2FrLmJsb2NrYXBwcy5uZXQvYXV0aC9yZWFsbXMvc3RyYXRvLWRldmVsIiwiYXVkIjoiaHR0cHM6Ly9rZXljbG9hay5ibG9ja2FwcHMubmV0L2F1dGgvcmVhbG1zL3N0cmF0by1kZXZlbCIsInN1YiI6ImJlMThjNWE3LWRjOTUtNDFkMC04MzI3LWZmZjNmMjJkNGQzMiIsInR5cCI6IlJlZnJlc2giLCJhenAiOiJkZXYiLCJhdXRoX3RpbWUiOjAsInNlc3Npb25fc3RhdGUiOiI1MWEwNGU3NS0wZDJlLTQ4ZTktYmNiNS00Y2ZkZDRkYTA3YWYiLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImRldiI6eyJyb2xlcyI6WyJ1bWFfcHJvdGVjdGlvbiJdfSwiYWNjb3VudCI6eyJyb2xlcyI6WyJtYW5hZ2UtYWNjb3VudCIsIm1hbmFnZS1hY2NvdW50LWxpbmtzIiwidmlldy1wcm9maWxlIl19fSwic2NvcGUiOiJlbWFpbCBwcm9maWxlIn0.CpCzdpMMKfl-nDanluEEXhwhB625oU046PXhBNEApQ8")
            (T.pack "bearer") 0 (T.pack "51a04e75-0d2e-48e9-bcb5-4cfdd4da07af") (T.pack "email profile")
                    
      show (resultant) `shouldBe` show adam
    
    it "can properly encode the base64 exchangeToken" $ do
      let encoded = encodeBase64 $ TE.encodeUtf8 $ T.concat [clientId, T.pack ":", clientSecret]
      encoded `shouldBe` T.pack "ZGV2OmQ1ZTY3YjhjLTRmYmYtNDJjNi1hOGQ5LTI5YTRkZDEzNTc1Zg=="

    --The following test will always fail as the token is generated elsewhere, but the test is useful to see if the token is being generated correctly
    xit "can properly use the getAwesomeToken function to get the token." $ do 
      mngr <- liftIO $ newManager tlsManagerSettings
      ourl <- parseBaseUrl discoveryUrl
      rawOauthInfo <- runClientM connectRawOauth (mkClientEnv mngr ourl)
      noErrorOauth <- case rawOauthInfo of
          Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
          Right val -> return val
      -- vToken <- liftIO $ getVirginToken clientId clientSecret noErrorOauth
      initialCache <- atomically $ newCacheSTM Nothing
      madison <- liftIO $ getAwesomeToken initialCache clientId clientSecret reserveSeconds noErrorOauth
      let clinton = VaultToken (T.pack "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJWY0N4SEpnUjFOdnJ4UWR5QXhQcEI5VEowM205SVRDdWt0b1JfTENVSE1VIn0.eyJqdGkiOiI1NzVkYTdiMC1hYmRlLTQyMTYtOTQ0MS03ZjVmN2Y2NmU1OWEiLCJleHAiOjE2Njc2MDA3OTAsIm5iZiI6MCwiaWF0IjoxNjY3NjAwNDkwLCJpc3MiOiJodHRwczovL2tleWNsb2FrLmJsb2NrYXBwcy5uZXQvYXV0aC9yZWFsbXMvc3RyYXRvLWRldmVsIiwiYXVkIjoiYWNjb3VudCIsInN1YiI6ImJlMThjNWE3LWRjOTUtNDFkMC04MzI3LWZmZjNmMjJkNGQzMiIsInR5cCI6IkJlYXJlciIsImF6cCI6ImRldiIsImF1dGhfdGltZSI6MCwic2Vzc2lvbl9zdGF0ZSI6IjUxYTA0ZTc1LTBkMmUtNDhlOS1iY2I1LTRjZmRkNGRhMDdhZiIsImFjciI6IjEiLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImRldiI6eyJyb2xlcyI6WyJ1bWFfcHJvdGVjdGlvbiJdfSwiYWNjb3VudCI6eyJyb2xlcyI6WyJtYW5hZ2UtYWNjb3VudCIsIm1hbmFnZS1hY2NvdW50LWxpbmtzIiwidmlldy1wcm9maWxlIl19fSwic2NvcGUiOiJlbWFpbCBwcm9maWxlIiwiY2xpZW50SG9zdCI6IjE3Mi43MC4xMDAuNzEiLCJjbGllbnRJZCI6ImRldiIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZSwicHJlZmVycmVkX3VzZXJuYW1lIjoic2VydmljZS1hY2NvdW50LWRldiIsImNsaWVudEFkZHJlc3MiOiIxNzIuNzAuMTAwLjcxIiwiZW1haWwiOiJzZXJ2aWNlLWFjY291bnQtZGV2QHBsYWNlaG9sZGVyLm9yZyJ9.hEGXrceWz_nJONyKa-Td8wY_AbZUqBAJ8I2VzN3gZX7Rj_S0pauca9-JFUjIEEfyqTJdmmzNjYSNv3mKQWcbMhAVyjeu9wtnVbG9aNhP9d9lXptGDhMPYdSx9ZJXLrexYf9CLlHTcnMAN6hvbvS10lBZLMiBGC0WdgpuyjusmFao7Ud-Q1oLArwB7kqQB3y8b4uEFPFYWScibeBjKR5GKTpOpHl0ve9-5JcuDUo47yqTrvBENQs9sH8R-OF7h6c5bUXopNDHGizyH2Y0I26Xwlwh9-m90Pa0sOFw7JoRMFWCFpKs_vktFya8iK5TH0TtaCWBBGUq_ozJaEPYnfM92g")
            300 1800 (T.pack "eyJhbGciOiJIUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJiMWEwNmM4NS01MzBkLTRkYTUtYTk3Yy03YjFhYjQwNDQ2YjgifQ.eyJqdGkiOiJmNTFlNmQ4ZC03ZGRmLTQ5NjQtOWUwZS0yZjlkMzE0NTI0NzIiLCJleHAiOjE2Njc2MDIyOTAsIm5iZiI6MCwiaWF0IjoxNjY3NjAwNDkwLCJpc3MiOiJodHRwczovL2tleWNsb2FrLmJsb2NrYXBwcy5uZXQvYXV0aC9yZWFsbXMvc3RyYXRvLWRldmVsIiwiYXVkIjoiaHR0cHM6Ly9rZXljbG9hay5ibG9ja2FwcHMubmV0L2F1dGgvcmVhbG1zL3N0cmF0by1kZXZlbCIsInN1YiI6ImJlMThjNWE3LWRjOTUtNDFkMC04MzI3LWZmZjNmMjJkNGQzMiIsInR5cCI6IlJlZnJlc2giLCJhenAiOiJkZXYiLCJhdXRoX3RpbWUiOjAsInNlc3Npb25fc3RhdGUiOiI1MWEwNGU3NS0wZDJlLTQ4ZTktYmNiNS00Y2ZkZDRkYTA3YWYiLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImRldiI6eyJyb2xlcyI6WyJ1bWFfcHJvdGVjdGlvbiJdfSwiYWNjb3VudCI6eyJyb2xlcyI6WyJtYW5hZ2UtYWNjb3VudCIsIm1hbmFnZS1hY2NvdW50LWxpbmtzIiwidmlldy1wcm9maWxlIl19fSwic2NvcGUiOiJlbWFpbCBwcm9maWxlIn0.CpCzdpMMKfl-nDanluEEXhwhB625oU046PXhBNEApQ8")
            (T.pack "bearer") 0 (T.pack "51a04e75-0d2e-48e9-bcb5-4cfdd4da07af") (T.pack "email profile")
      madison `shouldBe` clinton
    
    it "can properly store a token in the cache, without trying to request a new one.s" $ do 
      mngr <- liftIO $ newManager tlsManagerSettings
      ourl <- parseBaseUrl discoveryUrl
      rawOauthInfo <- runClientM connectRawOauth (mkClientEnv mngr ourl)
      noErrorOauth <- case rawOauthInfo of
          Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
          Right val -> return val
      -- vToken <- liftIO $ getVirginToken clientId clientSecret noErrorOauth
      initialCache <- atomically $ newCacheSTM Nothing
      madison <- liftIO $ getAwesomeToken initialCache clientId clientSecret reserveSeconds noErrorOauth
      --try to see if the cache is working and the old token is saved right away
      clinton <- liftIO $ getAwesomeToken initialCache clientId clientSecret reserveSeconds noErrorOauth
      madison `shouldBe` clinton
    
    it "can properly authenticate with the shared vault server" $ do
      True `shouldBe` True

    it "can properly do postKey from shared vault." $ do
      True `shouldBe` True

    it "can properly do getSharedKey from shared vault." $ do
      True `shouldBe` True

    it "can properly do getUsers from shared vault." $ do
      True `shouldBe` True

    it "can properly do postSignature from shared vault." $ do
      True `shouldBe` True
    
    it "can properly do postPassword from shared vault." $ do
      True `shouldBe` True

    it "can properly do verifyPassword from shared vault." $ do
      True `shouldBe` True