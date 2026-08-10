{-# LANGUAGE OverloadedStrings #-}
-- | Test suite for Poseidon hash
-- Test vectors from circomlibjs

module Main where

import Test.Hspec
import Crypto.Hash.Poseidon
import qualified Crypto.Hash.Poseidon2 as P2

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

  describe "Poseidon2 (gnark-crypto BN254 defaults, t=2 rF=6 rP=50)" $ do
    -- Test vectors generated from gnark-crypto v0.20.1 ecc/bn254/fr/poseidon2

    it "permutes (0, 0) correctly" $ do
      let (a, b) = P2.permutation (toF 0, toF 0)
      (fromF a, fromF b) `shouldBe`
        ( 5760396826252723620130659814739767625264053726049147948400048226670170422969
        , 18622970401557034651033185129330286139447343337105683528700775943440799145467 )

    it "permutes (1, 2) correctly" $ do
      let (a, b) = P2.permutation (toF 1, toF 2)
      (fromF a, fromF b) `shouldBe`
        ( 1197409642805673503548047715485910702500396810305169145705533208671921662963
        , 1313337560616139085277676701856612540166622156368305732529371734734451176750 )

    it "compresses (1, 2) with the right-input feed-forward" $ do
      fromF (P2.compress (toF 1) (toF 2)) `shouldBe`
        1313337560616139085277676701856612540166622156368305732529371734734451176752

    it "Merkle-Damgard hashes [1] correctly" $ do
      fromF (P2.hash [toF 1]) `shouldBe`
        12157562999385135173166708316607836110878334226144932937475223226141207470306

    it "Merkle-Damgard hashes [1, 2] correctly" $ do
      fromF (P2.hash [toF 1, toF 2]) `shouldBe`
        4443443265955166080716935670700081889283598504231460571509928329665379862364

    it "Merkle-Damgard hashes [1, 2, 3, 4] correctly" $ do
      fromF (P2.hash (map toF [1, 2, 3, 4])) `shouldBe`
        5402851635480781446751342346210135834226319730389436212287936564310709451361

    it "Merkle-Damgard hashes [0..9] correctly" $ do
      fromF (P2.hash (map toF [0 .. 9])) `shouldBe`
        16191854207462619476933326392729612834530730884080381722066254905795027646701

    it "hash of a single block equals compress with zero IV" $ do
      fromF (P2.hash [toF 42]) `shouldBe` fromF (P2.compress (toF 0) (toF 42))

  describe "Field arithmetic" $ do
    it "handles modular reduction" $ do
      fromF (toF fieldPrime) `shouldBe` 0
      fromF (toF (fieldPrime + 1)) `shouldBe` 1

    it "handles multiplication" $ do
      fromF (fMul (toF 2) (toF 3)) `shouldBe` 6

    it "handles exponentiation" $ do
      fromF (fPow (toF 2) 10) `shouldBe` 1024
