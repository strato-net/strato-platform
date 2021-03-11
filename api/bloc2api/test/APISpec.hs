module Main where

import Test.Hspec
import Data.Aeson
import BlockApps.Bloc22.Crypto

main :: IO ()
main = hspec spec

spec :: Spec
spec =
  describe "KeyStore JSON" $ do
    it "roundtrips through the network correctly" $
      let got = eitherDecode . encode $ exKeyStore
          want = Right exKeyStore
      in got `shouldBe` want
