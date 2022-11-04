module VaultProxySpec (
  spec) where


import VaultProxyLib

-- import Test.QuickCheck
-- import Control.Exception (evaluate)
-- import Control.Lens
import Control.Monad.IO.Class
-- import Data.ByteString          as BS
import Data.Cache
-- import Data.String.UTF8
import qualified Data.Text               as T
import Data.ByteString.Base64
import Data.Text.Encoding       as TE
import Network.HTTP.Client
import Network.HTTP.Conduit
-- import Network.OAuth.OAuth2     as OA  hiding (error)
import Servant.Client
import System.Clock
import Test.Hspec
-- import URI.ByteString           as UB

discoveryUrl :: String
discoveryUrl = "https://keycloak.blockapps.net/auth/realms/fti/.well-known/openid-configuration" 
-- discoveryUrl = "https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration"
clientId :: T.Text
clientId     = T.pack "dev"
clientSecret :: T.Text
clientSecret = T.pack "fe2d59c8-8378-4a57-8c86-45bf972fa028"
-- clientSecret = T.pack "d5e67b8c-4fbf-42c6-a8d9-29a4dd13575f"
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
      noErrorOauth `shouldBe` RawOauth (T.pack "https://keycloak.blockapps.net/auth/realms/fti/protocol/openid-connect/auth") (T.pack "https://keycloak.blockapps.net/auth/realms/fti/protocol/openid-connect/token")
    
    it "can use the virgin token function." $ do
      mngr <- liftIO $ newManager tlsManagerSettings
      ourl <- parseBaseUrl discoveryUrl
      rawOauthInfo <- runClientM connectRawOauth (mkClientEnv mngr ourl)
      noErrorOauth <- case rawOauthInfo of
          Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
          Right val -> return val
      authyUrl <- getVirginToken mngr clientId clientSecret noErrorOauth
      let adam = TE.encodeUtf8 $ T.pack "https://keycloak.blockapps.net/auth/realms/fti/protocol/openid-connect/auth?client_id=dev&redirect_uri=http%3A%2F%2Flocalhost%3A8080&response_type=code&scope=openid"
          resultant = authyUrl
      show (resultant) `shouldBe` show adam
    
    it "can properly encode the base64 exchangeToken" $ do
      let encoded = encodeBase64 $ TE.encodeUtf8 $ T.concat [clientId, T.pack ":", clientSecret]
      encoded `shouldBe` T.pack "ZGV2OmZlMmQ1OWM4LTgzNzgtNGE1Ny04Yzg2LTQ1YmY5NzJmYTAyOA=="
    
    -- it "can properly store the OAuth Token" $ do
    --   --Create a new cache 🐿️
    --   let cache = newCacheSTM getCurrentTime
