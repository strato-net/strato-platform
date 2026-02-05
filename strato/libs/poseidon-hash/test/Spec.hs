{-# LANGUAGE OverloadedStrings #-}
-- | Test suite for Poseidon hash
-- Test vectors from circomlibjs

module Main where

import Test.Hspec
import Crypto.Hash.Poseidon

main :: IO ()
main = hspec $ do
  describe "Poseidon hash" $ do
    -- Test vectors from circomlibjs test suite
    -- https://github.com/iden3/circomlibjs/blob/main/test/poseidon.js
    
    it "hashes [1] correctly" $ do
      let result = poseidon [toF 1]
      fromF result `shouldBe` 
        18586133768512220936620570745912940619677854269274689475585506675881198879027

    it "hashes [1, 2] correctly" $ do
      let result = poseidon [toF 1, toF 2]
      fromF result `shouldBe` 
        7853200120776062878684798364095072458815029376092732009249414926327459813530

    it "hashes [1, 2, 0, 0, 0] correctly" $ do
      let result = poseidon [toF 1, toF 2, toF 0, toF 0, toF 0]
      fromF result `shouldBe`
        1018317224307729531995786483840663576608797660851238720571059489595066344487

    it "hashes [1, 2, 3, 4] correctly" $ do
      -- From circomlibjs: poseidonperm_x5_254_5 test
      let result = poseidon [toF 1, toF 2, toF 3, toF 4]
      fromF result `shouldBe`
        18821383157269793795438455681495246036402687001665670618754263018637548127333

    it "hashes [1,2,3,4,5,6] correctly" $ do
      -- From circomlibjs with initState=0
      let result = poseidon [toF 1, toF 2, toF 3, toF 4, toF 5, toF 6]
      fromF result `shouldBe`
        20400040500897583745843009878988256314335038853985262692600694741116813247201

    -- Note: Currently only supports up to 8 inputs (t=2 to t=9)
    -- 16-input test would require generating more constants

  describe "Field arithmetic" $ do
    it "handles modular reduction" $ do
      fromF (toF fieldPrime) `shouldBe` 0
      fromF (toF (fieldPrime + 1)) `shouldBe` 1

    it "handles multiplication" $ do
      fromF (fMul (toF 2) (toF 3)) `shouldBe` 6

    it "handles exponentiation" $ do
      fromF (fPow (toF 2) 10) `shouldBe` 1024
