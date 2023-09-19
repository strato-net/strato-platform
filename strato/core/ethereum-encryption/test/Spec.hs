import Blockchain.Data.PubKey
import Blockchain.Data.RLP
import Blockchain.ExtendedECDSA.Model.ExtendedSignature
import qualified Blockchain.Strato.Model.Secp256k1 as NEW
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import Data.Maybe
import Test.Hspec
import Test.QuickCheck

main :: IO ()
main = hspec spec

spec :: Spec
spec = do
  describe "basic test" $ do
    it "encode and decode signatures" $
      property $ \extsig ->
        rlpDecode (rlpEncode extsig) `shouldBe` (extsig :: ExtendedSignature)
  describe "secp256k1-haskell/cryptonite regressions" $ do
    it "can cross-convert public keys" $ do
      let pubBS = fst $ B16.decode $ C8.pack "0cf05b89208bfc93eae8d96a3cd243a96241980fed21aeb393421e48f92f5dc9d119598593433d6eb5a2d37289e0456d52001a43be84360bcb120acceb246b3c"
          oldPub = bytesToPoint pubBS
          -- proper SEC serialized public keys have a headerbyte 0x04 to indicidate ECDSA point
          -- libsecp256k1 checks for this when importing
          headerByte = B.singleton 0x04
          newPub = fromMaybe (error "could not import public key") (NEW.importPublicKey (headerByte `B.append` pubBS))
      pointToBytes oldPub `shouldBe` (B.drop 1 $ NEW.exportPublicKey False newPub)
      oldPub `shouldBe` secPubKeyToPoint newPub
      pointToSecPubKey oldPub `shouldBe` newPub
