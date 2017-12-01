{-# LANGUAGE OverloadedStrings #-}

module Database.Spec where

import           Test.Hspec
import Data.Text (pack, unpack)

import BlockApps.Bloc22.Database.Solc 
import BlockApps.Solidity.Parse.Parser (parseXabi)

main :: IO ()
main = hspec spec

spec :: Spec
spec = solcSpec

solcSpec :: Spec
solcSpec =
  describe "Solc Spec" $ do
    describe "insert __getSource__ function to solidity code" $ do
    -- NOTICE: When creating expected source files for getSource, use the `stripLines`
    --         function to strip lines appropriately
      it "should augment SimpleStorage code" $ do
        let solPath = "./test/contracts/SimpleStorage.sol"
            expectedPath = "./test/contracts/SimpleStorageGetSource.sol"
        soliditySrc <- pack <$> readFile solPath
        expected <- (pack . concat . lines) <$> readFile expectedPath
        expectedXabi <- fromEither $ parseXabi "" (unpack expected)
        augmentedSrc <- unpack <$> (fromEither $ addGetSourceFuncToSource soliditySrc)
        augmentedXabi <- fromEither $ parseXabi "" augmentedSrc
        augmentedXabi `shouldBe` expectedXabi

fromEither :: Either String a -> IO a
fromEither x = do
  logleft x
  let Right r = x
  return r

logleft :: Either String a -> IO ()
logleft x = case x of
  Left err -> putStrLn err
  Right _ -> return ()



-- newtype BinaryCode = BinaryCode Text
--   deriving(Eq, Show)
-- getBinaryFromSrc :: Text -> Text -> IO BinaryCode
-- getBinaryFromSrc name src = do
--    eRes <- compileSolcIO src
--    logleft eRes
--    print eRes
--    let Right (Object value) = eRes
--        Object value' = value HMap.! name
--        String tbin = value' HMap.! "bin-runtime"
--        bin = BinaryCode tbin
--    return bin
