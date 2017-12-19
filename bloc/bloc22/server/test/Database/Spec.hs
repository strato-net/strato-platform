{-# LANGUAGE OverloadedStrings #-}

module Database.Spec where

import           Test.Hspec
import Data.Text (Text, pack, unpack)
import Control.Monad
import Data.Either
import Data.Map (toList)
import Text.Parsec

import BlockApps.Bloc22.Database.Solc 
import BlockApps.Solidity.Parse.Parser (parseXabi)
import BlockApps.Solidity.Parse.Declarations
import BlockApps.Solidity.Xabi

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
        void . fromEither =<< compileSolcIO soliditySrc
        expected <- (pack . concat . lines) <$> readFile expectedPath
        expectedXabi <- fromEither $ parseXabi "" (unpack expected)
        augmentedSrc <- unpack <$> (fromEither $ addGetSourceFuncToSource soliditySrc)
        void . fromEither =<< compileSolcIO (pack augmentedSrc)
        augmentedXabi <- fromEither $ parseXabi "" augmentedSrc
        augmentedXabi `shouldBe` expectedXabi
      it "should augment AppMetadata code" $ do
        let solPath = "./test/contracts/AppMetadata.sol"
        soliditySrc <- pack <$> readFile solPath
        void . fromEither =<< compileSolcIO soliditySrc
        augmentedSrc <- unpack <$> (fromEither $ addGetSourceFuncToSource soliditySrc)
        void . fromEither =<< compileSolcIO (pack augmentedSrc)
        augmentedXabi <- fromEither $ parseXabi "" augmentedSrc
        augmentedXabi `shouldSatisfy` not . null . xabiModifiers . snd . (!! 0)
        augmentedXabi `shouldSatisfy` (== "onlyOwner") . unpack . fst . (!! 0) . toList . xabiModifiers . snd . (!! 0)
        let modifier = snd . (!! 0) . toList . xabiModifiers . snd $ augmentedXabi !! 0
        modifier `shouldSatisfy` null . toList . modifierArgs
      it "should augment ErrorCodes code" $ do
        let solPath = "./test/contracts/ErrorCodes.sol"
            expectedPath = "./test/contracts/ErrorCodesGetSource.sol"
        soliditySrc <- pack <$> readFile solPath
        void . fromEither =<< compileSolcIO soliditySrc
        expected <- (pack . concat . lines) <$> readFile expectedPath
        expectedXabi <- fromEither $ parseXabi "" (unpack expected)
        augmentedSrc <- unpack <$> (fromEither $ addGetSourceFuncToSource soliditySrc)
        void . fromEither =<< compileSolcIO (pack augmentedSrc)
        augmentedXabi <- fromEither $ parseXabi "" augmentedSrc
        augmentedXabi `shouldBe` expectedXabi
      it "should augment Util code" $ do
        let solPath = "./test/contracts/Util.sol"
            expectedPath = "./test/contracts/UtilGetSource.sol"
        soliditySrc <- pack <$> readFile solPath
        void . fromEither =<< compileSolcIO soliditySrc
        expected <- (pack . concat . lines) <$> readFile expectedPath
        expectedXabi <- fromEither $ parseXabi "" (unpack expected)
        augmentedSrc <- unpack <$> (fromEither $ addGetSourceFuncToSource soliditySrc)
        void . fromEither =<< compileSolcIO (pack augmentedSrc)
        augmentedXabi <- fromEither $ parseXabi "" augmentedSrc
        augmentedXabi `shouldBe` expectedXabi
      it "should augment Bid code" $ do
        let solPath = "./test/contracts/Bid.sol"
            expectedPath = "./test/contracts/BidGetSource.sol"
        soliditySrc <- pack <$> readFile solPath
        printUnlinedSource soliditySrc
        void . fromEither =<< compileSolcIO soliditySrc
        expected <- (pack . concat . lines) <$> readFile expectedPath
        expectedXabi <- fromEither $ parseXabi "" (unpack expected)
        augmentedSrc <- unpack <$> (fromEither $ addGetSourceFuncToSource soliditySrc)
        void . fromEither =<< compileSolcIO (pack augmentedSrc)
        augmentedXabi <- fromEither $ parseXabi "" augmentedSrc
        augmentedXabi `shouldBe` expectedXabi

      -- TODO: Move this test to a more appropriate location
      it "should parse a modifier declaration" $ do
        let mods = runParser (many solidityDeclaration) "" "-" "modifier onlyOwner { if(msg.sender != owner) throw; _; } modifier notOnlyOwner { if(msg.sender == owner) throw; _; }"
        mods `shouldSatisfy` isRight

fromEither :: (Show a) => Either String a -> IO a
fromEither x = do
  logleft x
  x `shouldSatisfy` isRight
  let Right r = x
  return r

logleft :: Either String a -> IO ()
logleft x = case x of
  Left err -> putStrLn err
  Right _ -> return ()

printUnlinedSource :: Text -> IO ()
printUnlinedSource = print . stripLines



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
