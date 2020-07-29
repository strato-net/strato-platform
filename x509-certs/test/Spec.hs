

import           Crypto.Random.Entropy
import           Crypto.PubKey.ECC.Types
import qualified Crypto.Secp256k1       as S
--import qualified Data.ByteString        as B
import           Data.Coerce
import           Data.Maybe
import           Data.X509

import           Test.Hspec

import           X509.Generate



main :: IO ()
main = hspec spec

makePriv :: IO (S.SecKey)
makePriv = do
  ent <- getEntropy 32
  return $ fromMaybe (error "could not create private key") (S.secKey ent)

spec :: Spec
spec = do
  describe "generates an x509 certificate" $ do 
    
    it "certificate pubkey matches original pubkey" $ do
      priv <- makePriv
      let pub = S.derivePubKey priv
          iss = Issuer "5" "0" "9" priv
          sub = Subject "x" "5" "0" "9" (S.derivePubKey priv)
      cert <- makeCert iss sub

      let certPub = certPubKey cert
          certPubSerialPoint = case certPub of
            PubKeyEC (PubKeyEC_Named SEC_p256k1 serialPoint) -> serialPoint
            _ -> error "wrong pubkey type in cert, should be secp256k1 named"
          exPub = PubKeyEC_Named SEC_p256k1 (SerializedPoint $ S.exportPubKey False pub)
          inPub = fromMaybe (error "could not import pubkey from cert") (S.importPubKey (coerce certPubSerialPoint)) 
      certPub `shouldBe` PubKeyEC exPub
      inPub `shouldBe` pub
      
      
