module BuiltinsSpec where

import qualified Blockchain.SolidVM.Builtins as B
import Blockchain.VM.SolidException (SolidException (..))
import Control.Exception (evaluate)
import Test.Hspec

-- BN254 base field modulus p and subgroup order r
p :: Integer
p = 21888242871839275222246405745257275088696311157297823662689037894645226208583

r :: Integer
r = 21888242871839275222246405745257275088548364400416034343698204186575808495617

-- G1 generator, its negation, and its double
g1, negG1, twoG1 :: (Integer, Integer)
g1 = (1, 2)
negG1 = (1, p - 2)
twoG1 =
  ( 1368015179489954701390400359078579693043519447331113978918064868415326638035,
    9918110051302171585080402603319702774565515993150576347155970296011118125764
  )

-- G2 generator in Ethereum/ecPairing coordinate order: xIm, xRe, yIm, yRe
g2Gen :: [Integer]
g2Gen =
  [ 11559732032986387107991004021392285783925812861821192530917403151452391805634,
    10857046999023057135944570762232829481370756359578518086990519993285655852781,
    4082367875863433681332203403145435568316851327593401208105741076214120093531,
    8495653923123431417604973247489272438418190587263600148770280649306958101930
  ]

-- A point on the twist curve E'(Fp2) that is NOT in the r-order subgroup
-- (generated with py_ecc; the twist's cofactor is ~2^254, so a random curve
-- point essentially never lands in the subgroup). Same coordinate order.
g2NonSubgroup :: [Integer]
g2NonSubgroup =
  [ 0,
    1,
    5912654199736721486680175016176231956195085055698687135131307249486702594212,
    18278151005453108793778860132295291098363647455926340152056652516292830556603
  ]

invalidArgs :: Selector SolidException
invalidArgs (InvalidArguments _ _) = True
invalidArgs _ = False

forcePair :: (Integer, Integer) -> IO (Integer, Integer)
forcePair pt@(x, y) = x `seq` y `seq` evaluate pt

spec :: Spec
spec = do
  describe "modExp" $ do
    it "computes b^e mod m" $
      B.modExp 5 3 7 `shouldBe` 6
    it "returns 0 for a zero modulus (EIP-198)" $
      B.modExp 5 3 0 `shouldBe` 0
    it "returns 1 for 0^0 (EIP-198)" $
      B.modExp 0 0 7 `shouldBe` 1
    it "rejects a negative exponent" $
      evaluate (B.modExp 5 (-1) 7) `shouldThrow` invalidArgs

  describe "ecAdd" $ do
    it "doubles the generator" $
      forcePair (B.ecAdd g1 g1) `shouldReturn` twoG1
    it "treats (0, 0) as the identity" $
      forcePair (B.ecAdd (0, 0) g1) `shouldReturn` g1
    it "P + (-P) is the identity" $
      forcePair (B.ecAdd g1 negG1) `shouldReturn` (0, 0)
    it "rejects off-curve points" $
      forcePair (B.ecAdd (1, 3) g1) `shouldThrow` invalidArgs
    it "rejects coordinates >= p" $
      forcePair (B.ecAdd (p, 2) g1) `shouldThrow` invalidArgs
    it "rejects negative coordinates" $
      forcePair (B.ecAdd (1, negate 2) g1) `shouldThrow` invalidArgs

  describe "ecMul" $ do
    it "2 * G equals G + G" $
      forcePair (B.ecMul g1 2) `shouldReturn` twoG1
    it "r * G is the identity" $
      forcePair (B.ecMul g1 r) `shouldReturn` (0, 0)
    it "scalars are reduced mod r" $
      forcePair (B.ecMul g1 (r + 1)) `shouldReturn` g1
    it "rejects off-curve points" $
      forcePair (B.ecMul (2, 2) 5) `shouldThrow` invalidArgs
    it "rejects coordinates >= p" $
      forcePair (B.ecMul (0, p) 5) `shouldThrow` invalidArgs

  describe "ecPairing" $ do
    it "an empty input verifies trivially" $
      evaluate (B.ecPairing []) `shouldReturn` True
    it "e(G, H) alone is not the identity" $
      evaluate (B.ecPairing ([1, 2] ++ g2Gen)) `shouldReturn` False
    it "e(G, H) * e(-G, H) is the identity" $
      evaluate (B.ecPairing ([1, 2] ++ g2Gen ++ [1, p - 2] ++ g2Gen)) `shouldReturn` True
    it "a pair containing the point at infinity contributes the identity" $
      evaluate (B.ecPairing ([0, 0] ++ g2Gen)) `shouldReturn` True
    it "rejects input that is not a multiple of 6" $
      evaluate (B.ecPairing [1, 2, 3]) `shouldThrow` invalidArgs
    it "rejects an off-curve G1 point" $
      evaluate (B.ecPairing ([1, 3] ++ g2Gen)) `shouldThrow` invalidArgs
    it "rejects G2 coordinates >= p" $
      evaluate (B.ecPairing ([1, 2] ++ [p, 0, 0, 0])) `shouldThrow` invalidArgs
    it "rejects an off-twist G2 point" $
      evaluate (B.ecPairing ([1, 2] ++ [1, 1, 1, 1])) `shouldThrow` invalidArgs
    it "rejects an on-curve G2 point outside the r-order subgroup" $
      evaluate (B.ecPairing ([1, 2] ++ g2NonSubgroup)) `shouldThrow` invalidArgs

  -- expected values generated from gnark-crypto v0.20.1
  -- (ecc/bn254/fr/poseidon2, default parameters t=2, rF=6, rP=50)
  describe "poseidon2" $ do
    it "hashes a single element like gnark's MerkleDamgard hasher" $
      B.poseidon2Hash [1]
        `shouldBe` 12157562999385135173166708316607836110878334226144932937475223226141207470306
    it "hashes two elements" $
      B.poseidon2Hash [1, 2]
        `shouldBe` 4443443265955166080716935670700081889283598504231460571509928329665379862364
    it "hashes four elements" $
      B.poseidon2Hash [1, 2, 3, 4]
        `shouldBe` 5402851635480781446751342346210135834226319730389436212287936564310709451361
    it "hashes ten elements" $
      B.poseidon2Hash [0 .. 9]
        `shouldBe` 16191854207462619476933326392729612834530730884080381722066254905795027646701
    it "compresses (0, 0) like gnark's Compress" $
      B.poseidon2Compress 0 0
        `shouldBe` 18622970401557034651033185129330286139447343337105683528700775943440799145467
    it "compresses (1, 2) with the right-input feed-forward" $
      B.poseidon2Compress 1 2
        `shouldBe` 1313337560616139085277676701856612540166622156368305732529371734734451176752
    it "rejects non-canonical inputs (v >= r)" $
      evaluate (B.poseidon2Hash [r]) `shouldThrow` invalidArgs
    it "rejects negative inputs" $
      evaluate (B.poseidon2Compress (-1) 0) `shouldThrow` invalidArgs
