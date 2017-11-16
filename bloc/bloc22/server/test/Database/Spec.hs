{-# LANGUAGE OverloadedStrings #-}

module Database.Spec where

import           Test.Hspec
import Data.Text (pack, unpack)

import BlockApps.Bloc22.Database.Solc (addGetSourceFuncToSource)

main :: IO ()
main = hspec spec

spec :: Spec
spec = solcSpec

solcSpec :: Spec
solcSpec =
  describe "Solc Spec" $ do
    it "should insert __getSource__ function to solidity code" $ do
      let solPath = "./test/contracts/SimpleStorage.sol"
          expectedPath = "./test/contracts/SimpleStorageGetSource.sol"
      soliditySrc <- pack <$> readFile solPath
      expected <- (pack . concat . lines) <$> readFile expectedPath
      let eaugmentedSrc = addGetSourceFuncToSource soliditySrc
      logleft eaugmentedSrc
      let Right augmentedSrc = eaugmentedSrc
      putStrLn . unpack $ augmentedSrc
      augmentedSrc `shouldBe` expected

logleft :: Either String a -> IO ()
logleft x = case x of
  Left err -> putStrLn err
  Right _ -> return ()
