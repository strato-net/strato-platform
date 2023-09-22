{-# LANGUAGE OverloadedStrings #-}

module PragmaSpec where

import Data.Either
import Data.Source.Annotation as SA
import Data.Source.Position as SP
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.File
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.Parse.Pragmas
import Test.Hspec
import Text.Parsec

dummyAnnotation :: SA.SourceAnnotation ()
dummyAnnotation =
  SA.SourceAnnotation
    { SA._sourceAnnotationStart =
        SP.SourcePosition
          { SP._sourcePositionName = "",
            SP._sourcePositionLine = 0,
            SP._sourcePositionColumn = 0
          },
      SA._sourceAnnotationEnd =
        SP.SourcePosition
          { SP._sourcePositionName = "",
            SP._sourcePositionLine = 0,
            SP._sourcePositionColumn = 0
          },
      SA._sourceAnnotationAnnotation = ()
    }

spec :: Spec
spec = do
  let pragmaParse = runParser solidityPragma initialParserState ""
  describe "Pragma" $ do
    it "should fail without an identifier" $
      pragmaParse "pragma;" `shouldSatisfy` isLeft
    it "should succeed without contents for version number" $
      pragmaParse "pragma typecheck;" `shouldSatisfy` isRight
    it "shoudl fail without a ;" $
      pragmaParse "pragma solc 0.4.8" `shouldSatisfy` isLeft

  let findVer = fmap (decideVersion . File . (: [])) . pragmaParse
  describe "Version Decision" $ do
    it "should default to version 0.4 when unspecified" $
      findVer "pragma notsolidity 0.5.0;" `shouldBe` Right ZeroPointFour

    it "should read version 0.4s correctly" $ do
      -- findVer "pragma solidity 0.4.3; " `shouldBe` Right ZeroPointFour
      findVer "pragma solidity   ^0.4.24 ;" `shouldBe` Right ZeroPointFour

    it "should read version 0.5s correctly" $ do
      findVer "pragma solidity 0.5.0;" `shouldBe` Right ZeroPointFive
      findVer "pragma solidity 0.5.2;" `shouldBe` Right ZeroPointFive
      findVer "pragma solidity   ^0.5.2  ;" `shouldBe` Right ZeroPointFive

    it "should choose the maximum of versions selected" $ do
      let file =
            File
              [ Pragma dummyAnnotation "solidity" "0.5.0",
                Pragma dummyAnnotation "solidity" "^0.4.25"
              ]
      decideVersion file `shouldBe` ZeroPointFive
      let file2 =
            File
              [ Pragma dummyAnnotation "solidity" "0.4.24",
                Pragma dummyAnnotation "solidity" "0.4.8"
              ]
      decideVersion file2 `shouldBe` ZeroPointFour
