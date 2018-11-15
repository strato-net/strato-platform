{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Database.Spec where

import           Test.Hspec
import Data.Text (pack, unpack)
import Control.Monad
import Data.Either
import qualified Data.Map.Strict as M
import Text.Parsec
import Text.Printf

import BlockApps.Bloc22.Database.Solc
import BlockApps.Solidity.Parse.Parser (parseXabi, parseXabiNoInheritanceMerge)
import BlockApps.Solidity.Parse.ParserTypes
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
      mapM_ (\(name :: String) -> it (printf "should unparse %s code" name)
                     . testUnparser $ printf "./test/contracts/%s.sol" name)
        [ "SimpleStorage"
        , "ErrorCodes"
        , "Util"
        , "Version"
        , "BidState"
        , "Bid"
        , "ProjectState"
        , "Project"
        , "ProjectEvent"
        , "ProjectManager"
        , "UserRole"
        , "User"
        , "UserManager"
        , "AdminInterface"
        , "Lottery"
        , "SimpleComment"
        , "SimpleString"
        , "BlockAppsBABlob"
        , "SimpleStringSingleQuotes"
        , "Constant"
        , "Commentary"
        , "DataTypeString"
        , "Ctor"
        , "Using"
        , "Library"
        , "Interface"
        ]
      it "should unparse AppMetadata code" $ do
        let solPath = "./test/contracts/AppMetadata.sol"
        soliditySrc <- pack <$> readFile solPath
        void . fromEither =<< compileSolcIO ZeroPointFour soliditySrc
        unparsedSrc <- fromEither . fmap unparse $ parseXabiNoInheritanceMerge "" (unpack soliditySrc)
        (actualVer, actualXabi) <- fromEither $ parseXabi "" unparsedSrc
        (expectedVer, expectedXabi) <- fromEither $ parseXabi "" (unpack soliditySrc)
        void . fromEither =<< compileSolcIO actualVer (pack unparsedSrc)
        actualVer `shouldBe` expectedVer
        actualXabi `shouldBe` expectedXabi
        actualXabi `shouldSatisfy` not . M.null . xabiModifiers . snd . (!! 0)
        actualXabi `shouldSatisfy` (== "onlyOwner") . unpack . fst . (M.elemAt 0) . xabiModifiers . snd . (!! 0)
        let modifier = snd . (M.elemAt 0) . xabiModifiers . snd $ actualXabi !! 0
        modifier `shouldSatisfy` M.null . modifierArgs
      it "should leave pragmas alone!" $ do
        soliditySrc <- pack <$> readFile "./test/contracts/Pragma.sol"
        let eXabi = parseXabi "" . unparse =<< parseXabiNoInheritanceMerge "" (unpack soliditySrc)
        actualXabi <- fromEither eXabi
        expectedXabi <- fromEither $ parseXabi "" (unpack soliditySrc)
        actualXabi `shouldBe` expectedXabi
      it "should get the correct compiler version" $ do
        soliditySrc <- readFile "./test/contracts/FivePointOh.sol"
        let eXabi = parseXabi "" soliditySrc
        fmap fst eXabi `shouldBe` Right ZeroPointFive
      -- TODO: Move this test to a more appropriate location
      it "should parse a modifier declaration" $ do
        let mods = runParser (many solidityDeclaration) "" "-" "modifier onlyOwner { if(msg.sender != owner) throw; _; } modifier notOnlyOwner { if(msg.sender == owner) throw; _; }"
        mods `shouldSatisfy` isRight


fromEither :: (Show a) => Either String a -> IO a
fromEither = either (error . ("Expected right: " ++)) return

testUnparser :: String -> IO ()
testUnparser solPath = do
  soliditySrc <- pack <$> readFile solPath
  let got  = parseXabi "" . unparse =<< parseXabiNoInheritanceMerge "" (unpack soliditySrc)
  (gotVer, _) <- fromEither got
  void . fromEither =<< compileSolcIO gotVer soliditySrc
  let want = parseXabi "" (unpack soliditySrc)
  got `shouldBe` want
