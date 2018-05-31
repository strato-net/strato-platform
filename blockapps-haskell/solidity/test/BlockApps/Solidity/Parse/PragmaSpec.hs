{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.Parse.PragmaSpec where

import           Data.Either
import           Test.Hspec
import           Data.Text                              (Text)
import           BlockApps.Solidity.Xabi                (Xabi)

import           BlockApps.Solidity.Parse.Parser

{-# ANN module ("HLint: ignore Redundant do" :: String) #-}

spec :: Spec
spec = do
  let
    srcVersion = "pragma solidity 0.4.8;"
    srcLiquidity = "pragma liquidity 0.4.8;"
    srcV= "pragma solidity v0.4.8;"
    srcStar = "pragma solidity 0.4.*;"
    srcFuture = "pragma solidity 0.4.11;"
    srcNoSemi = "pragma solidity v0.4.8"
    srcOr = "pragma solidity 0.3.6 || 0.4.8;"
    srcCarat = "pragma solidity ^0.4.8;"
    srcCaratBad = "pragma solidity ^0.3.0;"
    srcOr2 = "pragma solidity 0.3.6 || 0.4.0 || 0.4.8;"
    srcCaratOr = "pragma solidity ^0.3.6 || ^0.4.8;"
    srcTilde = "pragma solidity ~0.4;"
    srcTildeBad = "pragma solidity ~0.3;"
    srcTilde' = "pragma solidity ~0;"
    srcTildeStar = "pragma solidity ~*;"
    srcGT = "pragma solidity >0.4.0;"
    srcGTE = "pragma solidity >=0.4.8;"
    srcLT = "pragma solidity <0.5.0;"
    srcLTE = "pragma solidity <=0.4.8;"
    srcGTBad = "pragma solidity >0.5.0;"
    srcGTEBad = "pragma solidity >=0.5.0;"
    srcLTBad = "pragma solidity <0.4.0;"
    srcLTEBad = "pragma solidity <=0.4.0;"
    srcGTELTE = "pragma solidity >=0.4.0 <=0.4.20;"
    srcGTELTEOr = "pragma solidity >=0.5.0 <=0.5.11 || >=0.4;"
    srcRange = "pragma solidity 0.3.6 - 0.4.8;"
    srcRange' = "pragma solidity 0.2.3 - 0.4;"

  describe "Pragma" $ do
    it "should successfully parse a solidity contract with no pragma" $ do
      let
        parsedXabi = sol ""
      parsedXabi `shouldSatisfy` isRight
    it "should successfully parse a solidity pragma" $ do
      let
        parsedXabi = sol srcVersion
      parsedXabi `shouldSatisfy` isRight
    it "should return an error when the pragma name isn't solidity" $ do
      let
        parsedXabi = sol srcLiquidity
      parsedXabi `shouldSatisfy` isLeft
    it "should successfully parse a solidity pragma with a version wildcard" $ do
      let
        parsedXabi = sol srcStar
      parsedXabi `shouldSatisfy` isRight
    it "should successfully parse a solidity pragma with a leading 'v'" $ do
      let
        parsedXabi = sol srcV
      parsedXabi `shouldSatisfy` isRight
    it "should return an error when solidity pragma version isn't supported" $ do
      let
        parsedXabi = sol srcFuture
      parsedXabi `shouldSatisfy` isLeft
    it "should return an error when solidity pragma doesn't have trailing semicolon" $ do
      let
        parsedXabi = sol srcNoSemi
      parsedXabi `shouldSatisfy` isLeft
    it "should successfully parse a solidity pragma that uses the logical or operator" $ do
      let
        parsedXabi = sol srcOr
      parsedXabi `shouldSatisfy` isRight
    it "should successfully parse a solidity pragma that uses the carat symbol" $ do
      let
        parsedXabi = sol srcCarat
      parsedXabi `shouldSatisfy` isRight
    it "should return an error when solidity pragma that uses the carat symbol doesn't include current version" $ do
      let
        parsedXabi = sol srcCaratBad
      parsedXabi `shouldSatisfy` isLeft
    it "should successfully parse a solidity pragma that uses the logical or operator twice" $ do
      let
        parsedXabi = sol srcOr2
      parsedXabi `shouldSatisfy` isRight
    it "should successfully parse a solidity pragma that uses the logical or operator on two carat version ranges" $ do
      let
        parsedXabi = sol srcCaratOr
      parsedXabi `shouldSatisfy` isRight
    it "should successfully parse a solidity pragma that uses the tilde symbol" $ do
      let
        parsedXabi = sol srcTilde
      parsedXabi `shouldSatisfy` isRight
    it "should return an error when solidity pragma that uses the tilde symbol doesn't include current version" $ do
      let
        parsedXabi = sol srcTildeBad
      parsedXabi `shouldSatisfy` isLeft
    it "should successfully parse a solidity pragma that uses the tilde symbol with no minor version" $ do
      let
        parsedXabi = sol srcTilde'
      parsedXabi `shouldSatisfy` isRight
    it "should return an error when solidity pragma that uses the tilde symbol on the wildcard version" $ do
      let
        parsedXabi = sol srcTildeStar
      parsedXabi `shouldSatisfy` isLeft
    it "should successfully parse a solidity pragma that uses the greater than operator" $ do
      let
        parsedXabi = sol srcGT
      parsedXabi `shouldSatisfy` isRight
    it "should successfully parse a solidity pragma that uses the greater than or equal to operator" $ do
      let
        parsedXabi = sol srcGTE
      parsedXabi `shouldSatisfy` isRight
    it "should successfully parse a solidity pragma that uses the less than operator" $ do
      let
        parsedXabi = sol srcLT
      parsedXabi `shouldSatisfy` isRight
    it "should successfully parse a solidity pragma that uses the less than or equal to operator" $ do
      let
        parsedXabi = sol srcLTE
      parsedXabi `shouldSatisfy` isRight
    it "should return an error when solidity pragma that uses the greater than operator doesn't include current version" $ do
      let
        parsedXabi = sol srcGTBad
      parsedXabi `shouldSatisfy` isLeft
    it "should return an error when solidity pragma that uses the greater than or equal to operator doesn't include current version" $ do
      let
        parsedXabi = sol srcGTEBad
      parsedXabi `shouldSatisfy` isLeft
    it "should return an error when solidity pragma that uses the less than operator doesn't include current version" $ do
      let
        parsedXabi = sol srcLTBad
      parsedXabi `shouldSatisfy` isLeft
    it "should return an error when solidity pragma that uses the less than or equal to operator doesn't include current version" $ do
      let
        parsedXabi = sol srcLTEBad
      parsedXabi `shouldSatisfy` isLeft
    it "should successfully parse a solidity pragma that uses two operators in tandem" $ do
      let
        parsedXabi = sol srcGTELTE
      parsedXabi `shouldSatisfy` isRight
    it "should successfully parse a solidity pragma that uses three operators in tandem" $ do
      let
        parsedXabi = sol srcGTELTEOr
      parsedXabi `shouldSatisfy` isRight
    it "should successfully parse a solidity pragma that uses the range operator" $ do
      let
        parsedXabi = sol srcRange
      parsedXabi `shouldSatisfy` isRight
    it "should successfully parse a solidity pragma that uses the range operator on a truncated version number" $ do
      let
        parsedXabi = sol srcRange'
      parsedXabi `shouldSatisfy` isRight

sol :: String -> Either String [(Text, Xabi)]
sol = parseXabi "-"
