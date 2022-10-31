module VaultProxySpec where
import SpecHelper
import VaultProxyLib

spec :: Spec
spec = describe "Vault proxy library" $ do
  context "can get the exchange token from the OAUTH provider." $ do
    (add 1 2) `shouldBe` 3

main :: IO ()
main = hspec spec
