{-# LANGUAGE OverloadedStrings #-}

module Database.Spec where

import           Test.Hspec
import Data.Text (pack, unpack)
import Data.Either
import Data.Map (toList)
import Control.Monad.IO.Class (liftIO)
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
        expected <- (pack . concat . lines) <$> readFile expectedPath
        expectedXabi <- fromEither $ parseXabi "" (unpack expected)
        augmentedSrc <- unpack <$> (fromEither $ addGetSourceFuncToSource soliditySrc)
        augmentedXabi <- fromEither $ parseXabi "" augmentedSrc
        augmentedXabi `shouldBe` expectedXabi
    describe "insert __getSource__ function to solidity code" $ do
    -- NOTICE: When creating expected source files for getSource, use the `stripLines`
    --         function to strip lines appropriately
      it "should parse a modifier declaration" $ do
        let mods = runParser (many solidityDeclaration) "" "-" "modifier onlyOwner { if(msg.sender != owner) throw; _; } modifier notOnlyOwner { if(msg.sender == owner) throw; _; }"
        liftIO . putStrLn $ show mods
        mods `shouldSatisfy` isRight
      it "should augment SimpleStorage code" $ do
        let solPath = "./test/contracts/AppMetadata.sol"
        soliditySrc <- pack <$> readFile solPath
        liftIO . putStrLn $ show soliditySrc
        augmentedSrc <- unpack <$> (fromEither $ addGetSourceFuncToSource soliditySrc)
        liftIO . putStrLn $ show augmentedSrc
        augmentedXabi <- fromEither $ parseXabi "" augmentedSrc
        augmentedXabi `shouldSatisfy` not . null . xabiModifiers . snd . (!! 0)
        augmentedXabi `shouldSatisfy` (== "onlyOwner") . unpack . fst . (!! 0) . toList . xabiModifiers . snd . (!! 0)
        let modifier = snd . (!! 0) . toList . xabiModifiers . snd $ augmentedXabi !! 0
        modifier `shouldSatisfy` null . toList . modifierArgs

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
