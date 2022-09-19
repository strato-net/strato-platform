{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# OPTIONS -fno-warn-orphans      #-}

import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Secp256k1
import           BlockApps.X509

import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Crypto.PubKey.ECC.Types
import qualified Data.Aeson                           as Ae
import           Data.Coerce
import           Data.Maybe
import           Data.Hourglass

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
      cert <- makeCert Nothing iss sub
      let certPub = certPubKey cert
          certPubSerialPoint = case certPub of
            PubKeyEC (PubKeyEC_Named SEC_p256k1 serialPoint) -> serialPoint
            _ -> error "wrong pubkey type in cert, should be secp256k1 named"
          exPub = PubKeyEC_Named SEC_p256k1 (SerializedPoint $ exportPublicKey False pub)
          inPub = fromMaybe (error "could not import pubkey from cert") (importPublicKey (coerce certPubSerialPoint))
      certPub `shouldBe` PubKeyEC exPub
      inPub `shouldBe` pub
    it "makeCert can use dateTime" $ do
      let date = timeParse ISO8601_Date "2020-12-12"
      cert <- makeCert date iss sub
      let (_,b) = certValidity cert
      b `shouldBe` fromMaybe (error "Date in makeCert didn't return properly") date
    it "makeCert defaults to one year" $ do
      exprDate <- snd . certValidity <$> makeCert Nothing iss sub
      oneYearFromNow <- snd <$> liftIO getValidity
      dtDate exprDate `shouldBe` dtDate oneYearFromNow
    it "can do JSON encoding roundtrips" $ do
      cert <- flip runReaderT priv $ makeSignedCert Nothing Nothing iss sub
      Ae.decode (Ae.encode sub) `shouldBe` Just sub
      Ae.decode (Ae.encode cert) `shouldBe` Just cert
    it "can do PEM encoding roundtrips" $ do
      cert <- flip runReaderT priv $ makeSignedCert Nothing Nothing iss sub
      Right cert `shouldBe` bsToCert (certToBytes cert)
    it "can do RLP encoding roundtrips" $ do
      cert <- flip runReaderT priv $ makeSignedCert Nothing Nothing iss sub
      let rlp = rlpEncode cert
      rlpDecode rlp `shouldBe` cert
      rlpEncode cert `shouldBe` rlp
    it "can verify cert signatures" $ do
      (X509Certificate (CertificateChain (cert:_))) <- flip runReaderT priv $ makeSignedCert Nothing Nothing iss sub
      let sigVerification = verifySignedSignature (coerce cert) (certPubKey $ getCertificate $ coerce cert)
      sigVerification `shouldBe` SignaturePass
    it "can reject invalid signatures" $ do
      (X509Certificate (CertificateChain (cert:_))) <- flip runReaderT priv $ makeSignedCert Nothing Nothing iss sub
      fakePriv <- newPrivateKey
      let fakeSerialPub = SerializedPoint $ exportPublicKey False (derivePublicKey fakePriv)
          fakePub = PubKeyEC $ PubKeyEC_Named SEC_p256k1 fakeSerialPub
          sigVerification = verifySignedSignature (coerce cert) fakePub
      sigVerification `shouldBe` SignatureFailed SignatureInvalid
    it "can verify chained certificates" $ do
      -- Create certificate one
      priv1 <- newPrivateKey
      let iss0 = iss
          pub1 = derivePublicKey priv1
          sub1 = Subject "a" "15" (Just "44") (Just "17") pub1
          iss1 = (\(Subject a b c d _) -> Issuer a b c d) sub1
      cert1 <- flip runReaderT priv $ makeSignedCert Nothing Nothing iss0 sub1

      -- Create certificate two
      priv2 <- newPrivateKey
      let pub2 = derivePublicKey priv2
          sub2 = Subject "y" "6" (Just "1") (Just "10") pub2
          iss2 = (\(Subject a b c d _) -> Issuer a b c d) sub2
      cert2 <- flip runReaderT priv1 $ makeSignedCert Nothing (Just cert1) iss1 sub2

      -- Create certificate three
      priv3 <- newPrivateKey
      let pub3 = derivePublicKey priv3
          sub3 = Subject "z" "7" (Just "2") (Just "11") pub3
      cert3 <- flip runReaderT priv2 $ makeSignedCert Nothing (Just cert2) iss2 sub3

      verifyCert pub cert3 `shouldBe` True
    it "can reject invalid chained certificates" $ do
      fakePriv <- newPrivateKey

      -- Create certificate one using the fake private key
      priv1 <- newPrivateKey
      let iss0 = iss
          pub1 = derivePublicKey priv1
          sub1 = Subject "a" "15" (Just "44") (Just "17") pub1
          iss1 = (\(Subject a b c d _) -> Issuer a b c d) sub1
      cert1 <- flip runReaderT fakePriv $ makeSignedCert Nothing Nothing iss0 sub1

      -- Create certificate two
      priv2 <- newPrivateKey
      let pub2 = derivePublicKey priv2
          sub2 = Subject "y" "6" (Just "1") (Just "10") pub2
          iss2 = (\(Subject a b c d _) -> Issuer a b c d) sub2
      cert2 <- flip runReaderT priv1 $ makeSignedCert Nothing (Just cert1) iss1 sub2

      -- Create certificate three
      priv3 <- newPrivateKey
      let pub3 = derivePublicKey priv3
          sub3 = Subject "z" "7" (Just "2") (Just "11") pub3
      cert3 <- flip runReaderT priv2 $ makeSignedCert Nothing (Just cert2) iss2 sub3

      verifyCert pub cert3 `shouldBe` False

