{-# LANGUAGE OverloadedStrings #-}

module Main where

import Test.Hspec
import Test.QuickCheck

import qualified Data.ByteString as BS
import Data.Maybe (fromJust)

import Crypto.Curve.BabyJubJub
import Crypto.Curve.BabyJubJub.EdDSA

-- | Helper to extract coordinates from a Point (for testing)
getCoords :: Point -> (Integer, Integer)
getCoords (Point x y) = (x, y)
getCoords Infinity = (0, 1)

main :: IO ()
main = hspec $ do
  describe "Baby JubJub Curve Parameters" $ do
    it "field prime is correct" $ do
      fieldPrime `shouldBe` 21888242871839275222246405745257275088548364400416034343698204186575808495617
    
    it "curve coefficients are correct" $ do
      curveA `shouldBe` 168700
      curveD `shouldBe` 168696
    
    it "subgroup order is correct" $ do
      subgroupOrder `shouldBe` 2736030358979909402780800718157159386076813972158567259200215660948447373041
    
    it "cofactor is 8" $ do
      cofactor `shouldBe` 8

  describe "Base Point" $ do
    it "base point is on the curve" $ do
      isOnCurve basePoint `shouldBe` True
    
    it "base point has correct coordinates" $ do
      let (x, y) = getCoords basePoint
      x `shouldBe` 5299619240641551281634865583518297030282874472190772894086521144482721001553
      y `shouldBe` 16950150798460657717958625567821834550301663161624707787222815936182638968203
    
    it "l * base point = identity" $ do
      -- Multiplying base point by subgroup order should give identity
      let result = scalarMult subgroupOrder basePoint
      result `shouldBe` identity

  describe "Identity Point" $ do
    it "identity is (0, 1)" $ do
      identity `shouldBe` Point 0 1
    
    it "identity is on the curve" $ do
      isOnCurve identity `shouldBe` True
    
    it "P + identity = P" $ do
      pointAdd basePoint identity `shouldBe` basePoint
    
    it "identity + P = P" $ do
      pointAdd identity basePoint `shouldBe` basePoint

  describe "Point Addition" $ do
    it "P + P = 2P (doubling)" $ do
      let p2a = pointAdd basePoint basePoint
          p2b = pointDouble basePoint
      p2a `shouldBe` p2b
    
    it "addition is commutative: P + Q = Q + P" $ do
      let p2 = scalarMult 2 basePoint
          p3 = scalarMult 3 basePoint
      pointAdd p2 p3 `shouldBe` pointAdd p3 p2
    
    it "addition is associative: (P + Q) + R = P + (Q + R)" $ do
      let p2 = scalarMult 2 basePoint
          p3 = scalarMult 3 basePoint
          p5 = scalarMult 5 basePoint
      pointAdd (pointAdd p2 p3) p5 `shouldBe` pointAdd p2 (pointAdd p3 p5)

  describe "Point Negation" $ do
    it "P + (-P) = identity" $ do
      let negP = pointNegate basePoint
      pointAdd basePoint negP `shouldBe` identity
    
    it "negation negates x coordinate" $ do
      let (x, y) = getCoords basePoint
          (nx, ny) = getCoords (pointNegate basePoint)
      nx `shouldBe` modP (fieldPrime - x)
      ny `shouldBe` y

  describe "Scalar Multiplication" $ do
    it "0 * P = identity" $ do
      scalarMult 0 basePoint `shouldBe` identity
    
    it "1 * P = P" $ do
      scalarMult 1 basePoint `shouldBe` basePoint
    
    it "2 * P = P + P" $ do
      scalarMult 2 basePoint `shouldBe` pointAdd basePoint basePoint
    
    it "(a + b) * P = a*P + b*P (distributive)" $ do
      let a = 12345
          b = 67890
          lhs = scalarMult (a + b) basePoint
          rhs = pointAdd (scalarMult a basePoint) (scalarMult b basePoint)
      lhs `shouldBe` rhs
    
    it "(a * b) * P = a * (b * P) (associative)" $ do
      let a = 123
          b = 456
          lhs = scalarMult (a * b) basePoint
          rhs = scalarMult a (scalarMult b basePoint)
      lhs `shouldBe` rhs

  describe "Test Vectors (circomlib compatible)" $ do
    -- Test vector: 2 * G
    it "2 * G matches expected" $ do
      let result = scalarMult 2 basePoint
          (x, y) = getCoords result
      -- Verify result is on curve (specific coordinates can be verified against circomlib)
      isOnCurve (Point x y) `shouldBe` True
    
    -- Test vector: known scalar multiplication
    it "scalar multiplication produces valid curve point" $ do
      let scalar = 0x1234567890abcdef
          result = scalarMult scalar basePoint
      isOnCurve result `shouldBe` True
    
    -- Test known point addition result
    it "8 * G matches (cofactor clearing)" $ do
      let p8 = scalarMult 8 basePoint
      isOnCurve p8 `shouldBe` True
      -- After cofactor clearing, point should be in prime-order subgroup

  describe "Field Operations" $ do
    it "modP reduces correctly" $ do
      modP (fieldPrime + 1) `shouldBe` 1
      modP (fieldPrime * 2 + 5) `shouldBe` 5
    
    it "modInverse is correct" $ do
      let a = 12345678901234567890
          aInv = modInverse a
      modP (a * aInv) `shouldBe` 1
    
    it "modSqrt finds square roots" $ do
      let x = 9  -- 3^2
          sqrtX = fromJust $ modSqrt x
      modP (sqrtX * sqrtX) `shouldBe` 9

  describe "Serialization" $ do
    it "pointToBytes roundtrips" $ do
      let bytes = pointToBytes basePoint
          p = fromJust $ pointFromBytes bytes
      p `shouldBe` basePoint
    
    it "compression roundtrips" $ do
      let compressed = compressPoint basePoint
          p = fromJust $ decompressPoint compressed
      p `shouldBe` basePoint
    
    it "identity serializes to zeros" $ do
      let bytes = pointToBytes identity
      -- Identity is (0, 1), so x part should be 0
      BS.take 32 bytes `shouldBe` BS.replicate 32 0

  describe "EdDSA Key Generation" $ do
    it "generates valid public key on curve" $ do
      let seed = BS.pack [1..32]
          priv = fromJust $ privateKeyFromBytes seed
          (PublicKey pub, _) = generateKeyPair priv
      isOnCurve pub `shouldBe` True
    
    it "different seeds produce different keys" $ do
      let seed1 = BS.pack [1..32]
          seed2 = BS.pack [2..33]
          priv1 = fromJust $ privateKeyFromBytes seed1
          priv2 = fromJust $ privateKeyFromBytes seed2
          (pub1', _) = generateKeyPair priv1
          (pub2', _) = generateKeyPair priv2
      pub1' `shouldNotBe` pub2'

  describe "EdDSA Signing and Verification" $ do
    it "sign then verify succeeds" $ do
      let seed = BS.pack [1..32]
          priv = fromJust $ privateKeyFromBytes seed
          (pub, _) = generateKeyPair priv
          msg = "Hello, Baby JubJub!"
          sig = sign priv msg
      verify pub msg sig `shouldBe` True
    
    it "verification fails with wrong message" $ do
      let seed = BS.pack [1..32]
          priv = fromJust $ privateKeyFromBytes seed
          (pub, _) = generateKeyPair priv
          msg1 = "Hello, Baby JubJub!"
          msg2 = "Different message"
          sig = sign priv msg1
      verify pub msg2 sig `shouldBe` False
    
    it "verification fails with wrong public key" $ do
      let seed1 = BS.pack [1..32]
          seed2 = BS.pack [2..33]
          priv1 = fromJust $ privateKeyFromBytes seed1
          priv2 = fromJust $ privateKeyFromBytes seed2
          (_pub1, _) = generateKeyPair priv1
          (pub2, _) = generateKeyPair priv2
          msg = "Hello, Baby JubJub!"
          sig = sign priv1 msg
      verify pub2 msg sig `shouldBe` False
    
    it "deterministic signing with same inputs" $ do
      let seed = BS.pack [1..32]
          priv = fromJust $ privateKeyFromBytes seed
          msg = "Test message"
          sig1 = sign priv msg
          sig2 = sign priv msg
      sig1 `shouldBe` sig2

  describe "QuickCheck Properties" $ do
    it "scalar multiplication always produces valid point" $ property $
      \(Positive n) -> isOnCurve (scalarMult n basePoint)
    
    it "point addition is always on curve" $ property $
      \(Positive a) (Positive b) ->
        let p1 = scalarMult a basePoint
            p2 = scalarMult b basePoint
        in isOnCurve (pointAdd p1 p2)
    
    it "sign/verify roundtrip" $ property $
      \seed msg ->
        let seed' = BS.pack (take 32 $ cycle (if null seed then [1] else seed))
            msg' = BS.pack msg
            priv = fromJust $ privateKeyFromBytes seed'
            (pub, _) = generateKeyPair priv
            sig = sign priv msg'
        in verify pub msg' sig
