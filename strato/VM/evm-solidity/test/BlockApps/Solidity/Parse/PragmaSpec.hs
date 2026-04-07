{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.Parse.PragmaSpec where

import BlockApps.Solidity.Parse.ParserTypes
import BlockApps.Solidity.Parse.Pragmas
import Data.Either
import Test.Hspec
import Text.Parsec

spec :: Spec
spec = do
  let pragmaParse = runParser solidityPragma "" ""
  describe "Pragma" $ do
    it "should fail without an identifier" $
      pragmaParse "pragma;" `shouldSatisfy` isLeft
    it "should fail without contents for version number" $
      pragmaParse "pragma typecheck;" `shouldSatisfy` isLeft
    it "shoudl fail without a ;" $
      pragmaParse "pragma solc 0.4.8" `shouldSatisfy` isLeft
    it "should pass with arbitrary text" $
      pragmaParse "pragma randident don't fsck with my t3xt !!;"
        `shouldBe` Right (Pragma "randident" "don't fsck with my t3xt !!")

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
              [ Pragma "solidity" "0.5.0",
                Pragma "solidity" "^0.4.25"
              ]
      decideVersion file `shouldBe` ZeroPointFive
      let file2 =
            File
              [ Pragma "solidity" "0.4.24",
                Pragma "solidity" "0.4.8"
              ]
      decideVersion file2 `shouldBe` ZeroPointFour
