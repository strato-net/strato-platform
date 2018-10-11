{-# LANGUAGE OverloadedStrings #-}

module Database.Spec where

import           Test.Hspec
import Data.Text (pack, unpack)
import Control.Monad
import Data.Either
import Text.Parsec

import BlockApps.Bloc22.Database.Solc
import BlockApps.Solidity.Parse.Parser (parseXabi, parseXabiNoInheritanceMerge)
import BlockApps.Solidity.Parse.Declarations
import BlockApps.Solidity.Parse.UnParser (unparse)

main :: IO ()
main = hspec spec

spec :: Spec
spec = solcSpec

solcSpec :: Spec
solcSpec =
  describe "Solc Spec" $ do
    describe "insert __getSource__ function to solidity code" $ do
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
