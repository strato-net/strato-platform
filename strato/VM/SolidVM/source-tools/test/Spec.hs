{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

import qualified Data.Aeson as Ae
import Data.Source
import Data.Text (Text)
import Test.Hspec
import Test.QuickCheck

main :: IO ()
main = hspec spec

jsonRT :: (Ae.FromJSON a, Ae.ToJSON a) => a -> Either String a
jsonRT = Ae.eitherDecode . Ae.encode

spec :: Spec
spec = do
  describe "SourceAnnotation Text" $ do
    it "round trips correctly" $
      property $ \(src :: (SourceAnnotation Text)) -> do
        jsonRT src `shouldBe` Right src
  describe "SourceMap" $ do
    it "round trips correctly" $
      property $ \(src :: SourceMap) -> do
        jsonRT src `shouldBe` Right src
  describe "SourcePosition" $ do
    it "round trips correctly" $
      property $ \(src :: SourcePosition) -> do
        jsonRT src `shouldBe` Right src
