{-# LANGUAGE OverloadedStrings #-}

module Database.Spec where

import           Test.Hspec
import Data.Text (pack, unpack, Text)
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
      it "should augment SimpleStorage code" $ do
        let solPath = "./test/contracts/SimpleStorage.sol"
            expectedPath = "./test/contracts/SimpleStorageGetSource.sol"
        testAugment solPath expectedPath
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
        testAugment solPath expectedPath
      it "should augment Util code" $ do
        let solPath = "./test/contracts/Util.sol"
            expectedPath = "./test/contracts/UtilGetSource.sol"
        testAugment solPath expectedPath
      it "should augment Version code" $ do
        let solPath = "./test/contracts/Version.sol"
            expectedPath = "./test/contracts/VersionGetSource.sol"
        testAugment solPath expectedPath
      it "should augment BidState code" $ do
        let solPath = "./test/contracts/BidState.sol"
            expectedPath = "./test/contracts/BidStateGetSource.sol"
        testAugment solPath expectedPath
      it "should augment Bid code" $ do
        let solPath = "./test/contracts/Bid.sol"
            expectedPath = "./test/contracts/BidGetSource.sol"
        testAugment solPath expectedPath
      it "should augment ProjectState code" $ do
        let solPath = "./test/contracts/ProjectState.sol"
            expectedPath = "./test/contracts/ProjectStateGetSource.sol"
        testAugment solPath expectedPath
      it "should augment Project code" $ do
        let solPath = "./test/contracts/Project.sol"
            expectedPath = "./test/contracts/ProjectGetSource.sol"
        testAugment solPath expectedPath
      it "should augment ProjectEvent code" $ do
        let solPath = "./test/contracts/ProjectEvent.sol"
            expectedPath = "./test/contracts/ProjectEventGetSource.sol"
        testAugment solPath expectedPath
      it "should augment ProjectManager code" $ do
        let solPath = "./test/contracts/ProjectManager.sol"
            expectedPath = "./test/contracts/ProjectManagerGetSource.sol"
        testAugment solPath expectedPath
      it "should augment UserRole code" $ do
        let solPath = "./test/contracts/UserRole.sol"
            expectedPath = "./test/contracts/UserRoleGetSource.sol"
        testAugment solPath expectedPath
      it "should augment User code" $ do
        let solPath = "./test/contracts/User.sol"
            expectedPath = "./test/contracts/UserGetSource.sol"
        testAugment solPath expectedPath
      it "should augment UserManager code" $ do
        let solPath = "./test/contracts/UserManager.sol"
            expectedPath = "./test/contracts/UserManagerGetSource.sol"
        testAugment solPath expectedPath
      it "should augment AdminInterface code" $ do
        let solPath = "./test/contracts/AdminInterface.sol"
            expectedPath = "./test/contracts/AdminInterfaceGetSource.sol"
        testAugment solPath expectedPath
      it "should augment Lottery code" $ do
        let solPath = "./test/contracts/Lottery.sol"
            expectedPath = "./test/contracts/LotteryGetSource.sol"
        testAugment solPath expectedPath
      it "should augment SimpleComment code" $ do
        let solPath = "./test/contracts/SimpleComment.sol"
            expectedPath = "./test/contracts/SimpleCommentGetSource.sol"
        testAugment solPath expectedPath
      it "should augment SimpleString code" $ do
        let solPath = "./test/contracts/SimpleString.sol"
            expectedPath = "./test/contracts/SimpleStringGetSource.sol"
        testAugment solPath expectedPath
      it "should augment BlockAppsBABlob code" $ do
        let solPath = "./test/contracts/BlockAppsBABlob.sol"
            expectedPath = "./test/contracts/BlockAppsBABlobGetSource.sol"
        testAugment solPath expectedPath
      it "should augment SimpleString code with single quotes" $ do
        let solPath = "./test/contracts/SimpleStringSingleQuotes.sol"
            expectedPath = "./test/contracts/SimpleStringSingleQuotesGetSource.sol"
        testAugment solPath expectedPath
      it "should augment Constant code and keep constant" $ do
        let solPath = "./test/contracts/Constant.sol"
            expectedPath = "./test/contracts/ConstantGetSource.sol"
        testAugment solPath expectedPath
      it "should parse nested comments correctly" $ do
        let solPath = "./test/contracts/Commentary.sol"
            expectedPath = "./test/contracts/CommentaryGetSource.sol"
        testAugment solPath expectedPath
      it "should leave pragmas alone!" $ do
        let solPath = "./test/contracts/Pragma.sol"
        soliditySrc <- pack <$> readFile solPath
        augmentedSrc <- fromEither $ augment soliditySrc
        soliditySrc `shouldBe` augmentedSrc
      it "should not alter type of arrays" $ do
        let solPath = "./test/contracts/DataTypeString.sol"
            expectedPath = "./test/contracts/DataTypeStringGetSource.sol"
        testAugment solPath expectedPath
      it "should use modern constructor syntax" $ do
        let solPath = "./test/contracts/Ctor.sol"
            expectedPath = "./test/contracts/CtorGetSource.sol"
        testAugment solPath expectedPath
      it "should preserve using declarations" $ do
        let solPath = "./test/contracts/Using.sol"
            expectedPath = "./test/contracts/UsingGetSource.sol"
        testAugment solPath expectedPath
      it "should unparse libraries" $ do
        let solPath = "./test/contracts/Library.sol"
            expectedPath = "./test/contracts/LibraryGetSource.sol"
        testAugment solPath expectedPath
      it "should unparse interfaces" $ do
        let solPath = "./test/contracts/Interface.sol"
            expectedPath = "./test/contracts/InterfaceGetSource.sol"
        testAugment solPath expectedPath
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

augment :: Text -> Either String Text
augment = addGetNameFuncToSource <=< addGetSourceFuncToSource

testAugment :: String -> String -> IO ()
testAugment solPath expectedPath = do
  soliditySrc <- pack <$> readFile solPath
  void . fromEither =<< compileSolcIO soliditySrc
  expected <- pack <$> readFile expectedPath
  expectedXabi <- fromEither $ parseXabi "" (unpack expected)
  augmentedSrc <- unpack <$> (fromEither $ augment soliditySrc)
  void . fromEither =<< compileSolcIO (pack augmentedSrc)
  augmentedXabi <- fromEither $ parseXabi "" augmentedSrc
  augmentedXabi `shouldBe` expectedXabi

writeAugment :: String -> String -> IO ()
writeAugment solPath expectedPath = do
  soliditySrc <- pack <$> readFile solPath
  void . fromEither =<< compileSolcIO soliditySrc
  augmentedSrc <- unpack <$> (fromEither $ augment soliditySrc)
  writeFile expectedPath augmentedSrc

printAugment :: String -> IO ()
printAugment solPath = do
  soliditySrc <- pack <$> readFile solPath
  void . fromEither =<< compileSolcIO soliditySrc
  augmentedSrc <- (fromEither $ augment soliditySrc)
  print augmentedSrc
