{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# OPTIONS -fno-warn-orphans      #-}

import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Secp256k1
import           BlockApps.X509

import           Control.Monad.Trans.Reader
import           Crypto.PubKey.ECC.Types
import qualified Data.Aeson                           as Ae
import           Data.Coerce
import           Data.Maybe

import           Test.Hspec


type TestCertM = ReaderT PrivateKey IO

instance HasVault TestCertM where
  getPub = error "we never call getPub with this tool"
  getShared _ = error "we never call getShared with this tool"
  sign bs = ask >>= return . flip signMsg bs 


main :: IO ()
main = hspec spec


spec :: Spec
spec = do
  describe "x509 certificates" $ do 
    priv <- runIO newPrivateKey
    let pub = derivePublicKey priv
        iss = Issuer "x" "5" (Just "0") (Just "9") 
        sub = Subject "x" "5" (Just "0") (Just "9") pub

    it "can do serialization roundtrips on pubkeys" $ do
      let serialKey = serializeAndWrap pub
      Just pub `shouldBe` unserializeAndUnwrap serialKey
    it "certificate pubkey matches original pubkey" $ do
      cert <- makeCert iss sub
      let certPub = certPubKey cert
          certPubSerialPoint = case certPub of
            PubKeyEC (PubKeyEC_Named SEC_p256k1 serialPoint) -> serialPoint
            _ -> error "wrong pubkey type in cert, should be secp256k1 named"
          exPub = PubKeyEC_Named SEC_p256k1 (SerializedPoint $ exportPublicKey False pub)
          inPub = fromMaybe (error "could not import pubkey from cert") (importPublicKey (coerce certPubSerialPoint)) 
      certPub `shouldBe` PubKeyEC exPub
      inPub `shouldBe` pub
    it "can do JSON encoding roundtrips" $ do
      cert <- flip runReaderT priv $ makeSignedCert Nothing iss sub
      Ae.decode (Ae.encode sub) `shouldBe` Just sub
      Ae.decode (Ae.encode cert) `shouldBe` Just cert 
    it "can do PEM encoding roundtrips" $ do
      cert <- flip runReaderT priv $ makeSignedCert Nothing iss sub
      Right cert `shouldBe` bsToCert (certToBytes cert)
    it "can do RLP encoding roundtrips" $ do
      cert <- flip runReaderT priv $ makeSignedCert Nothing iss sub
      let rlp = rlpEncode cert
      rlpDecode rlp `shouldBe` cert
      rlpEncode cert `shouldBe` rlp
    it "can verify cert signatures" $ do
      (X509Certificate (CertificateChain (cert:_))) <- flip runReaderT priv $ makeSignedCert Nothing iss sub
      let sigVerification = verifySignedSignature (coerce cert) (certPubKey $ getCertificate $ coerce cert)
      sigVerification `shouldBe` SignaturePass
    it "can reject invalid signatures" $ do
      (X509Certificate (CertificateChain (cert:_))) <- flip runReaderT priv $ makeSignedCert Nothing iss sub
      fakePriv <- newPrivateKey
      let fakeSerialPub = SerializedPoint $ exportPublicKey False (derivePublicKey fakePriv)
          fakePub = PubKeyEC $ PubKeyEC_Named SEC_p256k1 fakeSerialPub
          sigVerification = verifySignedSignature (coerce cert) fakePub
      sigVerification `shouldBe` SignatureFailed SignatureInvalid
