

import           Crypto.PubKey.ECC.Types
import qualified Crypto.Secp256k1       as S
import           Data.Coerce
import           Data.Maybe


import           BlockApps.X509
import           Blockchain.Data.RLP
import           Test.Hspec



main :: IO ()
main = hspec spec


spec :: Spec
spec = do
  describe "x509 certificates" $ do 
    priv <- runIO newPriv 
    let pub = S.derivePubKey priv
        iss = Issuer "x" "5" "0" "9" priv
        sub = Subject "x" "5" "0" "9" (S.derivePubKey priv)

    it "certificate pubkey matches original pubkey" $ do
      cert <- makeCert iss sub
      let certPub = certPubKey cert
          certPubSerialPoint = case certPub of
            PubKeyEC (PubKeyEC_Named SEC_p256k1 serialPoint) -> serialPoint
            _ -> error "wrong pubkey type in cert, should be secp256k1 named"
          exPub = PubKeyEC_Named SEC_p256k1 (SerializedPoint $ S.exportPubKey False pub)
          inPub = fromMaybe (error "could not import pubkey from cert") (S.importPubKey (coerce certPubSerialPoint)) 
      certPub `shouldBe` PubKeyEC exPub
      inPub `shouldBe` pub
      
    it "can do PEM encoding roundtrips" $ do
      cert <- makeSignedCert iss sub
      Right cert `shouldBe` bsToCert (certToBytes cert)
    it "can do RLP encoding roundtrips" $ do
      cert <- makeSignedCert iss sub
      let rlp = rlpEncode cert
      rlpDecode rlp `shouldBe` cert
      rlpEncode cert `shouldBe` rlp
    it "can verify cert signatures" $ do
      cert <- makeSignedCert iss sub
      let sigVerification = verifySignedSignature cert (certPubKey $ getCertificate cert)
      sigVerification `shouldBe` SignaturePass
    it "can reject invalid signatures" $ do
      cert <- makeSignedCert iss sub
      fakePriv <- newPriv
      let fakeSerialPub = SerializedPoint $ S.exportPubKey False (S.derivePubKey fakePriv)
          fakePub = PubKeyEC $ PubKeyEC_Named SEC_p256k1 fakeSerialPub
          sigVerification = verifySignedSignature cert fakePub
      sigVerification `shouldBe` SignatureFailed SignatureInvalid
