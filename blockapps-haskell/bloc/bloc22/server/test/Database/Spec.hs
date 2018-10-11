{-# LANGUAGE OverloadedStrings #-}

module Database.Spec where

import           Test.Hspec
import Data.Text (pack, unpack)
import Control.Monad
import Data.Either
import qualified Data.Map.Strict as M
import Text.Parsec

import BlockApps.Bloc22.Database.Solc
import BlockApps.Solidity.Parse.Parser (parseXabi, parseXabiNoInheritanceMerge)
import BlockApps.Solidity.Parse.Declarations
import BlockApps.Solidity.Parse.UnParser (unparse)
import BlockApps.Solidity.Xabi

main :: IO ()
main = hspec spec

spec :: Spec
spec = solcSpec

solcSpec :: Spec
solcSpec =
  describe "Solc Spec" $ do
    describe "parse and unparse solidity code" $ do
      it "should unparse SimpleStorage code" $ do
        testUnparser "./test/contracts/SimpleStorage.sol"
      it "should unparse AppMetadata code" $ do
        let solPath = "./test/contracts/AppMetadata.sol"
        soliditySrc <- pack <$> readFile solPath
        void . fromEither =<< compileSolcIO soliditySrc
        unparsedSrc <- fromEither . fmap unparse $ parseXabiNoInheritanceMerge "" (unpack soliditySrc)
        actualXabi <- fromEither $ parseXabi "" unparsedSrc
        expectedXabi <- fromEither $ parseXabi "" (unpack soliditySrc)
        void . fromEither =<< compileSolcIO (pack unparsedSrc)
        actualXabi `shouldBe` expectedXabi
        actualXabi `shouldSatisfy` not . M.null . xabiModifiers . snd . (!! 0)
        actualXabi `shouldSatisfy` (== "onlyOwner") . unpack . fst . (M.elemAt 0) . xabiModifiers . snd . (!! 0)
        let modifier = snd . (M.elemAt 0) . xabiModifiers . snd $ actualXabi !! 0
        modifier `shouldSatisfy` M.null . modifierArgs
      it "should unparse ErrorCodes code" $ do
        testUnparser "./test/contracts/ErrorCodes.sol"
      it "should unparse Util code" $ do
        testUnparser "./test/contracts/Util.sol"
      it "should unparse Version code" $ do
        testUnparser "./test/contracts/Version.sol"
      it "should unparse BidState code" $ do
        testUnparser "./test/contracts/BidState.sol"
      it "should unparse Bid code" $ do
        testUnparser "./test/contracts/Bid.sol"
      it "should unparse ProjectState code" $ do
        testUnparser "./test/contracts/ProjectState.sol"
      it "should unparse Project code" $ do
        testUnparser "./test/contracts/Project.sol"
      it "should unparse ProjectEvent code" $ do
        testUnparser "./test/contracts/ProjectEvent.sol"
      it "should unparse ProjectManager code" $ do
        testUnparser "./test/contracts/ProjectManager.sol"
      it "should unparse UserRole code" $ do
        testUnparser "./test/contracts/UserRole.sol"
      it "should unparse User code" $ do
        testUnparser "./test/contracts/User.sol"
      it "should unparse UserManager code" $ do
        testUnparser "./test/contracts/UserManager.sol"
      it "should unparse AdminInterface code" $ do
        testUnparser "./test/contracts/AdminInterface.sol"
      it "should unparse Lottery code" $ do
        testUnparser "./test/contracts/Lottery.sol"
      it "should unparse SimpleComment code" $ do
        testUnparser "./test/contracts/SimpleComment.sol"
      it "should unparse SimpleString code" $ do
        testUnparser "./test/contracts/SimpleString.sol"
      it "should unparse BlockAppsBABlob code" $ do
        testUnparser "./test/contracts/BlockAppsBABlob.sol"
      it "should unparse SimpleString code with single quotes" $ do
        testUnparser "./test/contracts/SimpleStringSingleQuotes.sol"
      it "should unparse Constant code and keep constant" $ do
        testUnparser "./test/contracts/Constant.sol"
      it "should parse nested comments correctly" $ do
        testUnparser "./test/contracts/Commentary.sol"
      it "should leave pragmas alone!" $ do
        soliditySrc <- pack <$> readFile "./test/contracts/Pragma.sol"
        let eXabi = parseXabi "" . unparse =<< parseXabiNoInheritanceMerge "" (unpack soliditySrc)
        actualXabi <- fromEither eXabi
        expectedXabi <- fromEither $ parseXabi "" (unpack soliditySrc)
        actualXabi `shouldBe` expectedXabi
      it "should not alter type of arrays" $ do
        testUnparser "./test/contracts/DataTypeString.sol"
      it "should use modern constructor syntax" $ do
        testUnparser "./test/contracts/Ctor.sol"
      it "should preserve using declarations" $ do
        testUnparser "./test/contracts/Using.sol"
      it "should unparse libraries" $ do
        testUnparser "./test/contracts/Library.sol"
      it "should unparse interfaces" $ do
        testUnparser "./test/contracts/Interface.sol"
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

testUnparser :: String -> IO ()
testUnparser solPath = do
  soliditySrc <- pack <$> readFile solPath
  void . fromEither =<< compileSolcIO soliditySrc
  let eXabi = parseXabi "" . unparse =<< parseXabiNoInheritanceMerge "" (unpack soliditySrc)
  actualXabi <- fromEither eXabi
  expectedXabi <- fromEither $ parseXabi "" (unpack soliditySrc)
  actualXabi `shouldBe` expectedXabi
