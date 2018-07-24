import Test.Hspec
import Test.QuickCheck

import Blockchain.Data.RLP
import Blockchain.ExtendedECDSA

main :: IO ()
main = hspec spec

spec :: Spec
spec = describe "basic test" $ do
    it "encode and decode signatures" $ property $ \extsig ->
        rlpDecode (rlpEncode extsig) `shouldBe` (extsig :: ExtendedSignature)
