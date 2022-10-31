module VaultProxySpec (spec) where



import VaultProxyLib

-- import Test.QuickCheck
-- import Control.Exception (evaluate)
import Control.Monad.IO.Class
import Network.HTTP.Client
import Network.HTTP.Conduit
import Servant.Client
import Test.Hspec
import qualified Data.Text               as T


spec :: Spec
spec = do
  describe "Vault proxy library" $ do
    it "can get the initial connection information." $ do
      let discoveryUrl = "https://keycloak.blockapps.net/auth/realms/fti/.well-known/openid-configuration" 
      mngr <- liftIO $ newManager tlsManagerSettings
      ourl <- parseBaseUrl discoveryUrl
      rawOauthInfo <- runClientM connectRawOauth (mkClientEnv mngr ourl)
      noErrorOauth <- case rawOauthInfo of
          Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
          Right val -> return val
      noErrorOauth `shouldBe` RawOauth (T.pack "Hello") (T.pack "World")