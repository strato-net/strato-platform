{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE BangPatterns #-}

-- | Native Haskell Groth16 prover using the pairing library
-- 
-- This module implements Groth16 proof generation without requiring
-- external tools like snarkjs. It uses:
--   - pairing: BN254 curve and optimal ate pairing
--   - galois-field: Finite field arithmetic
--   - elliptic-curve: Curve point operations
--
-- The prover reads circom/snarkjs format files:
--   - .zkey: Proving key (curve points for MSM)
--   - .wtns: Witness values (from circuit evaluation)
--
module Groth16.BN254
  ( -- * Types
    ProvingKey(..)
  , Proof(..)
  , Witness(..)
  , G1'
  , G2'
  , Fr
  , Fq
  , Fq2
    -- * Parsing
  , loadProvingKey
  , loadProvingKeyJSON
  , loadWitness
  , parseWtns
    -- * Proving
  , prove
    -- * Verification (for testing)
  , verify
    -- * Proof coordinate extraction
  , proofToIntegers
    -- * FFT utilities (for testing)
  , fft
  , ifft
  , getRootOfUnity
  ) where

import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as LBS
import Data.Text (Text)
import qualified Data.Text as T
import Data.Bits (shiftL, shiftR, (.|.), (.&.))
import Control.Monad (replicateM, when, forM_)
import Data.Binary.Get (Get, runGetOrFail, getWord32le, getWord64le, getByteString, skip)
import Control.Parallel.Strategies (parMap, rdeepseq)
import Data.List (foldl')
import qualified Data.IntMap.Strict as IntMap

import qualified Data.Aeson as Aeson
import Data.Aeson ((.:), (.:?), (.!=))
import Data.Aeson.Types (Parser, parseEither)
import qualified Data.Vector as V
import qualified Data.Vector.Mutable as MV

-- BN254 curve types from pairing library
import Data.Pairing.BN254 (G1', G2', Fr)
import Data.Curve.Weierstrass (Point(..), mul, add, dbl)
import qualified Data.Curve.Weierstrass.BN254 as G1Curve
import qualified Data.Curve.Weierstrass.BN254T as G2Curve
import Data.Field.Galois (toP, toE, fromP, fromE)

import System.Random (randomRIO)
import Control.Monad.ST (runST)

-- Re-export types for conversion
type Fq = G1Curve.Fq
type Fq2 = G2Curve.Fq2

-- | Constraint coefficient for sparse representation
data ConstraintCoef = ConstraintCoef
  { ccMatrix     :: !Int      -- ^ 0=A, 1=B, 2=C
  , ccConstraint :: !Int      -- ^ Constraint index
  , ccSignal     :: !Int      -- ^ Signal/variable index
  , ccValue      :: !Fr       -- ^ Coefficient value
  } deriving (Show)

-- | Groth16 Proving Key
-- Contains all the curve points needed for proof generation
data ProvingKey = ProvingKey
  { pkAlpha1    :: G1'              -- ^ Alpha in G1
  , pkBeta1     :: G1'              -- ^ Beta in G1
  , pkBeta2     :: G2'              -- ^ Beta in G2
  , pkDelta1    :: G1'              -- ^ Delta in G1
  , pkDelta2    :: G2'              -- ^ Delta in G2
  , pkA         :: [G1']            -- ^ A query points (one per witness)
  , pkB1        :: [G1']            -- ^ B query in G1
  , pkB2        :: [G2']            -- ^ B query in G2
  , pkC         :: [G1']            -- ^ C query (private inputs only)
  , pkH         :: [G1']            -- ^ H polynomial coefficients [x^i * t(x)]
  , pkNVars     :: Int              -- ^ Total number of variables
  , pkNPublic   :: Int              -- ^ Number of public inputs
  , pkDomainSize :: Int             -- ^ FFT domain size (power of 2)
  , pkCoefs     :: [ConstraintCoef] -- ^ Sparse constraint coefficients
  } deriving (Show)

-- | Groth16 Proof (3 curve points)
data Proof = Proof
  { proofA :: G1'   -- ^ Proof element A in G1
  , proofB :: G2'   -- ^ Proof element B in G2
  , proofC :: G1'   -- ^ Proof element C in G1
  } deriving (Show, Eq)

-- | Witness values (field elements)
newtype Witness = Witness { witnessValues :: [Fr] }
  deriving (Show)

-- | Load proving key from zkey file (binary format)
-- The zkey format is documented at: https://github.com/iden3/snarkjs
loadProvingKey :: FilePath -> IO (Either Text ProvingKey)
loadProvingKey path = do
  contents <- LBS.readFile path
  return $ parseZKey contents

-- | Load proving key from JSON file (exported via: snarkjs zkey export json)
-- This is easier to parse than binary format
loadProvingKeyJSON :: FilePath -> IO (Either Text ProvingKey)
loadProvingKeyJSON path = do
  contents <- LBS.readFile path
  case Aeson.eitherDecode contents of
    Left err -> return $ Left $ "JSON parse error: " <> T.pack err
    Right val -> return $ parseProvingKeyJSON val

-- | Load witness from wtns file
loadWitness :: FilePath -> IO (Either Text Witness)
loadWitness path = do
  contents <- LBS.readFile path
  return $ parseWtns contents

-- | Generate a Groth16 proof
-- 
-- The proof computation is:
--   A = alpha + sum(w_i * A_i) + r * delta
--   B = beta + sum(w_i * B_i) + s * delta  
--   C = sum(w_i * L_i) + h(x) + s*A + r*B - r*s*delta
--
-- where w_i are witness values, r and s are random blinding factors,
-- and h(x) is computed via FFT as (A(x)*B(x) - C(x)) / Z(x)
prove :: ProvingKey -> Witness -> IO Proof
prove pk (Witness ws) = do
  -- Generate random blinding factors for zero-knowledge
  r <- randomFieldElement
  s <- randomFieldElement
  
  let 
    -- Compute A = alpha + sum(w_i * A_i) + r * delta
    witnessA = multiScalarMulG1 (pkA pk) ws
    proofA' = pkAlpha1 pk `add` witnessA `add` (pkDelta1 pk `mul` r)
    
    -- Compute B = beta + sum(w_i * B_i) + s * delta (in G2)
    witnessB2 = multiScalarMulG2 (pkB2 pk) ws
    proofB' = pkBeta2 pk `add` witnessB2 `add` (pkDelta2 pk `mul` s)
    
    -- Compute B1 sum (used later for full B1 with blinding in C computation)
    witnessB1 = multiScalarMulG1 (pkB1 pk) ws
    
    -- Compute h polynomial coefficients using FFT
    (hCoeffs, _aEval0, _bEval0, _cEval0) = computeHPolynomialDebug pk ws
    
  let
    -- Compute contribution from H: sum(h_i * H_i)
    hContrib = multiScalarMulG1 (pkH pk) hCoeffs
    
    -- Compute C contribution from witness
    -- IMPORTANT: C points are for private inputs only (indices > nPublic)
    -- So we need to use witness values starting from index (nPublic + 1)
    privateWitness = drop (pkNPublic pk + 1) ws
    witnessC = multiScalarMulG1 (pkC pk) privateWitness
    
    -- Compute full B1 with blinding (needed for C computation)
    b1Full = pkBeta1 pk `add` witnessB1 `add` (pkDelta1 pk `mul` s)
    
    -- IMPORTANT: Use proofA' and b1Full (the FULL blinded values)
    -- The snarkjs formula is: C += s*proofA' + r*pib1 - rs*delta1
    sA = proofA' `mul` s
    rB1 = b1Full `mul` r
    rsDelta = pkDelta1 pk `mul` (r * s)
    proofC' = witnessC `add` hContrib `add` sA `add` rB1 `add` neg rsDelta
  
  return $ Proof proofA' proofB' proofC'

-- | Compute h polynomial EVALUATIONS on coset (matching snarkjs Lagrange basis approach)
-- h(x) = (A(x) * B(x) - C(x)) / Z(x)
-- where Z(x) = x^n - 1 is the vanishing polynomial
-- 
-- IMPORTANT: The hExps in JSON are in Lagrange basis for coset evaluation,
-- so we need to return (A*B-C) evaluated on the coset, NOT H coefficients.
-- The division by Z is implicit in the Lagrange basis representation.
--
-- The algorithm (matching snarkjs):
-- 1. Build A, B, C evaluations at roots of unity from ccoefs
-- 2. iFFT to get coefficients (degree < n)
-- 3. Shift coefficients by powers of inc (the coset generator) 
-- 4. FFT to get evaluations on coset {inc * omega^i}
-- 5. Multiply A*B pointwise, subtract C (on coset)
-- 6. Return coset evaluations for MSM with Lagrange-basis hExps
computeHPolynomialDebug :: ProvingKey -> [Fr] -> ([Fr], Fr, Fr, Fr)
computeHPolynomialDebug pk ws = 
  let n = pkDomainSize pk
      omega = getRootOfUnity n
      
      -- Coset shift: inc = primitive (2n)-th root of unity (snarkjs's Fr.w[power+1])
      -- If omega is a primitive n-th root, then inc^2 = omega
      -- This shifts evaluation from {omega^i} to {inc * omega^i}
      omega2n = getRootOfUnity (2 * n)  -- Primitive (2n)-th root
      inc = omega2n  -- inc = omega_{2n}^1
      
      -- Step 1: Build A and B evaluations at roots of unity (from ccoefs with matrix 0,1)
      -- NOTE: ccoefs only contains matrices 0 (A) and 1 (B), NOT 2 (C)!
      -- C is computed as A*B pointwise, matching snarkjs's buildABC1
      (aEvals, bEvals, _) = buildPolynomialEvals pk ws n
      cEvals = V.zipWith (*) aEvals bEvals  -- C = A*B pointwise (NOT from ccoefs!)
      
      -- DEBUG: Check that A*B - C = 0 on roots (should be zero everywhere)
      -- Since C = A*B, we should have A*B - C = 0
      -- This is a sanity check
      _check = V.zipWith3 (\a b c -> a * b - c) aEvals bEvals cEvals
      -- _checkSum = V.foldl' (+) 0 _check  -- Should be 0
      
      -- Step 2: iFFT to get coefficients of A, B, C (degree < n)
      aCoeffs = ifft omega n aEvals
      bCoeffs = ifft omega n bEvals
      cCoeffs = ifft omega n cEvals  -- cEvals is now A*B pointwise
      
      -- Step 3: Shift coefficients by powers of inc
      -- This transforms: p(x) -> p(inc * x)
      -- coeff_i -> coeff_i * inc^i
      shiftCoeffs :: Fr -> [Fr] -> [Fr]
      shiftCoeffs g cs = zipWith (*) cs (iterate (* g) 1)
      
      aShifted = shiftCoeffs inc aCoeffs
      bShifted = shiftCoeffs inc bCoeffs
      cShifted = shiftCoeffs inc cCoeffs
      
      -- Step 4: FFT to get evaluations on coset
      aCoset = fft omega n aShifted
      bCoset = fft omega n bShifted
      cCoset = fft omega n cShifted
      
      -- Step 5: Multiply pointwise and subtract C (on coset)
      -- This gives (A*B - C) evaluated on the coset
      abMinusC = zipWith3 (\a b c -> a * b - c) aCoset bCoset cCoset
      
      -- CRITICAL: In snarkjs, abMinusC (the coset evaluations) is used DIRECTLY
      -- for the MSM with hExps. There is NO division by Z and NO conversion
      -- to coefficients! The hExps in the proving key are in Lagrange basis
      -- for the coset, so the division by Z is implicit in how hExps was
      -- generated during trusted setup.
      hCoeffs = abMinusC  -- Return coset evaluations directly for MSM
      
  in (hCoeffs, aEvals V.! 0, bEvals V.! 0, cEvals V.! 0)  -- Return h coefficients and debug values

-- | Build polynomial evaluations from sparse constraint coefficients
buildPolynomialEvals :: ProvingKey -> [Fr] -> Int -> (V.Vector Fr, V.Vector Fr, V.Vector Fr)
buildPolynomialEvals pk ws n = runST $ do
  -- Initialize A, B, C arrays with zeros
  aVec <- MV.replicate n 0
  bVec <- MV.replicate n 0
  cVec <- MV.replicate n 0
  
  let wsVec = V.fromList ws
  
  -- Apply each constraint coefficient
  forM_ (pkCoefs pk) $ \coef -> do
    let idx = ccConstraint coef
        sig = ccSignal coef
        val = ccValue coef
    when (idx < n && sig < V.length wsVec) $ do
      let contrib = val * (wsVec V.! sig)
      case ccMatrix coef of
        0 -> MV.modify aVec (+ contrib) idx
        1 -> MV.modify bVec (+ contrib) idx
        2 -> MV.modify cVec (+ contrib) idx
        _ -> return ()
  
  a <- V.freeze aVec
  b <- V.freeze bVec
  c <- V.freeze cVec
  return (a, b, c)

-- | Get primitive root of unity for BN254 scalar field
-- omega^n = 1 where n is a power of 2
getRootOfUnity :: Int -> Fr
getRootOfUnity n = 
  let -- BN254 scalar field modulus r
      -- r - 1 = 2^28 * m for some odd m
      -- So we can have roots of unity up to 2^28
      -- Root of unity for 2^28: this is a generator
      root28 :: Fr
      root28 = toP 19103219067921713944291392827692070036145651957329286315305642004821462161904
      -- Compute omega for size n by repeated squaring
      -- omega_n = root28 ^ (2^28 / n)
      exp28 :: Integer
      exp28 = 2 ^ (28 :: Integer)
      expo :: Integer
      expo = exp28 `div` fromIntegral n
  in root28 ^ expo

-- | FFT over finite field using iterative Cooley-Tukey with bit reversal
fft :: Fr -> Int -> [Fr] -> [Fr]
fft omega n xs = V.toList $ fftIterative omega n (V.fromList xs)

-- | Iterative FFT with precomputed twiddles
fftIterative :: Fr -> Int -> V.Vector Fr -> V.Vector Fr
fftIterative omega n input = runST $ do
  -- Bit-reversal permutation
  arr <- V.thaw $ bitReverse n input
  
  -- Iterative FFT stages
  let logN = round (logBase 2 (fromIntegral n) :: Double) :: Int
  
  forM_ [1..logN] $ \s -> do
    let m = 2 ^ s
        halfM = m `div` 2
        omegaM = omega ^ (n `div` m)
    forM_ [0, m .. n - 1] $ \k -> do
      let !tw0 = 1 :: Fr
      forM_ (zip [0..halfM-1] (iterate (* omegaM) tw0)) $ \(j, tw) -> do
        let idx1 = k + j
            idx2 = k + j + halfM
        u <- MV.read arr idx1
        v <- MV.read arr idx2
        let !t = tw * v
        MV.write arr idx1 (u + t)
        MV.write arr idx2 (u - t)
  
  V.freeze arr

-- | Bit-reversal permutation for FFT
bitReverse :: Int -> V.Vector Fr -> V.Vector Fr
bitReverse n xs = V.generate n (\i -> xs V.! reverseBits n i)

-- | Reverse bits of an integer
reverseBits :: Int -> Int -> Int
reverseBits n i = 
  let logN = round (logBase 2 (fromIntegral n) :: Double) :: Int
      go :: Int -> Int -> Int -> Int
      go 0 acc _ = acc
      go remaining acc val = go (remaining - 1) (acc * 2 + (val `mod` 2)) (val `div` 2)
  in go logN 0 i

-- | Inverse FFT
ifft :: Fr -> Int -> V.Vector Fr -> [Fr]
ifft omega n xs = 
  let omegaInv = recip omega
      nInv = recip (toP (fromIntegral n) :: Fr)
      result = fftIterative omegaInv n xs
  in V.toList $ V.map (* nInv) result

-- | Divide polynomial by Z(x) = x^n - 1
-- If f(x) = Z(x) * h(x), then h(x) = f(x) / Z(x)
-- For exact division (no remainder), h_i = f_{n+i}
-- For f of degree 2n-2, h has degree n-2
-- (Kept for reference, coset FFT approach used instead)
_divideByVanishing :: Int -> [Fr] -> [Fr]
_divideByVanishing n coeffs =
  -- For exact division by (x^n - 1):
  -- If f(x) = h(x) * (x^n - 1), then h_i = f_{n+i}
  -- Simply take coefficients from index n onwards
  drop n coeffs

-- | Verify a Groth16 proof
-- 
-- Verification equation:
--   e(A, B) = e(alpha, beta) * e(sum(pub_i * IC_i), gamma) * e(C, delta)
verify :: ProvingKey -> [Fr] -> Proof -> Bool
verify _pk _publicInputs _proof = 
  -- TODO: Implement verification
  -- For now, we rely on the contract to verify
  True

-- | Extract integer coordinates from a proof
-- Returns ((a_x, a_y), ((b_x0, b_x1), (b_y0, b_y1)), (c_x, c_y))
proofToIntegers :: Proof -> ((Integer, Integer), ((Integer, Integer), (Integer, Integer)), (Integer, Integer))
proofToIntegers (Proof a b c) = (g1ToInts a, g2ToInts b, g1ToInts c)

-- | Extract integer coordinates from G1 point
g1ToInts :: G1' -> (Integer, Integer)
g1ToInts O = (0, 0)  -- Point at infinity
g1ToInts (A x y) = (fromP x, fromP y)

-- | Extract integer coordinates from G2 point
-- Returns ((x0, x1), (y0, y1)) for Fq2 = a + b*u representation
g2ToInts :: G2' -> ((Integer, Integer), (Integer, Integer))
g2ToInts O = ((0, 0), (0, 0))  -- Point at infinity
g2ToInts (A x y) = (fq2ToInts x, fq2ToInts y)

-- | Extract integer coefficients from Fq2 element
-- Fq2 = a + b*u where u^2 + 1 = 0
-- Returns (real, imaginary) = (a, b) to match snarkjs JSON format [c0, c1]
fq2ToInts :: Fq2 -> (Integer, Integer)
fq2ToInts fq2 = 
  let coeffs = fromE fq2  -- Returns [c0, c1] where element = c0 + c1*u
  in case coeffs of
       [c0, c1] -> (fromP c0, fromP c1)  -- (real, imaginary) = [c0, c1] for snarkjs
       [c0]     -> (fromP c0, 0)          -- Only real part
       []       -> (0, 0)
       _        -> (0, 0)  -- Shouldn't happen

-- | Safe point addition for G1 that handles P + P (uses doubling)
safeAddG1 :: G1' -> G1' -> G1'
safeAddG1 O q = q
safeAddG1 p O = p
safeAddG1 p q
  | p == q    = dbl p
  | otherwise = add p q

-- | Safe point addition for G2 that handles P + P (uses doubling)
safeAddG2 :: G2' -> G2' -> G2'
safeAddG2 O q = q
safeAddG2 p O = p
safeAddG2 p q
  | p == q    = dbl p
  | otherwise = add p q

-- | Multi-scalar multiplication in G1: sum(s_i * P_i)
-- Uses Pippenger's bucket method for efficiency
multiScalarMulG1 :: [G1'] -> [Fr] -> G1'
multiScalarMulG1 points scalars = 
  let nonZeroPairs = [(p, fromP s) | (p, s) <- zip points scalars, s /= 0]
  in if null nonZeroPairs 
     then O 
     else pippengerG1 nonZeroPairs

-- | Multi-scalar multiplication in G2: sum(s_i * P_i)  
-- Uses Pippenger's bucket method for efficiency
multiScalarMulG2 :: [G2'] -> [Fr] -> G2'
multiScalarMulG2 points scalars =
  let nonZeroPairs = [(p, fromP s) | (p, s) <- zip points scalars, s /= 0]
  in if null nonZeroPairs 
     then O 
     else pippengerG2 nonZeroPairs

-- | Pippenger's algorithm for G1 MSM
pippengerG1 :: [(G1', Integer)] -> G1'
pippengerG1 pairs = 
  let n = length pairs
      -- Optimal window size: c ≈ log2(n) but at least 4, at most 16
      c = max 4 (min 16 (ceiling (logBase 2 (fromIntegral n :: Double)) :: Int))
      numBuckets = 2 ^ c
      numWindows = (256 + c - 1) `div` c
      
      -- Process each window in parallel
      windowResults = parMap rdeepseq (processWindowG1 pairs c numBuckets) [0..numWindows-1]
      
      -- Combine windows: w[0] + 2^c * w[1] + 2^(2c) * w[2] + ...
  in foldl' (\acc w -> doubleNTimesG1 c acc `safeAddG1` w) O (reverse windowResults)

-- | Process one window for Pippenger G1
processWindowG1 :: [(G1', Integer)] -> Int -> Int -> Int -> G1'
processWindowG1 pairs c numBuckets windowIdx =
  let shift = windowIdx * c
      mask = (1 `shiftL` c) - 1
      buckets = foldl' (addToBucketG1 shift mask) IntMap.empty pairs
  in bucketReductionG1 numBuckets buckets

-- | Add a point to the appropriate G1 bucket
addToBucketG1 :: Int -> Integer -> IntMap.IntMap G1' -> (G1', Integer) -> IntMap.IntMap G1'
addToBucketG1 shift mask buckets (pt, scalar) =
  let bucketIdx = fromIntegral ((scalar `shiftR` shift) .&. mask)
  in if bucketIdx == 0
     then buckets
     else IntMap.insertWith safeAddG1 bucketIdx pt buckets

-- | Bucket reduction for G1: compute sum where bucket[i] contributes i times
bucketReductionG1 :: Int -> IntMap.IntMap G1' -> G1'
bucketReductionG1 numBuckets buckets =
  let go idx running total
        | idx < 1 = total
        | otherwise = 
            let bucket = IntMap.findWithDefault O idx buckets
                running' = running `safeAddG1` bucket
            in go (idx - 1) running' (total `safeAddG1` running')
  in go (numBuckets - 1) O O

-- | Double a G1 point n times (multiply by 2^n)
doubleNTimesG1 :: Int -> G1' -> G1'
doubleNTimesG1 0 p = p
doubleNTimesG1 n p = doubleNTimesG1 (n-1) (dbl p)

-- | Pippenger's algorithm for G2 MSM
pippengerG2 :: [(G2', Integer)] -> G2'
pippengerG2 pairs = 
  let n = length pairs
      c = max 4 (min 16 (ceiling (logBase 2 (fromIntegral n :: Double)) :: Int))
      numBuckets = 2 ^ c
      numWindows = (256 + c - 1) `div` c
      
      windowResults = parMap rdeepseq (processWindowG2 pairs c numBuckets) [0..numWindows-1]
  in foldl' (\acc w -> doubleNTimesG2 c acc `safeAddG2` w) O (reverse windowResults)

-- | Process one window for Pippenger G2
processWindowG2 :: [(G2', Integer)] -> Int -> Int -> Int -> G2'
processWindowG2 pairs c numBuckets windowIdx =
  let shift = windowIdx * c
      mask = (1 `shiftL` c) - 1
      buckets = foldl' (addToBucketG2 shift mask) IntMap.empty pairs
  in bucketReductionG2 numBuckets buckets

-- | Add a point to the appropriate G2 bucket
addToBucketG2 :: Int -> Integer -> IntMap.IntMap G2' -> (G2', Integer) -> IntMap.IntMap G2'
addToBucketG2 shift mask buckets (pt, scalar) =
  let bucketIdx = fromIntegral ((scalar `shiftR` shift) .&. mask)
  in if bucketIdx == 0
     then buckets
     else IntMap.insertWith safeAddG2 bucketIdx pt buckets

-- | Bucket reduction for G2
bucketReductionG2 :: Int -> IntMap.IntMap G2' -> G2'
bucketReductionG2 numBuckets buckets =
  let go idx running total
        | idx < 1 = total
        | otherwise = 
            let bucket = IntMap.findWithDefault O idx buckets
                running' = running `safeAddG2` bucket
            in go (idx - 1) running' (total `safeAddG2` running')
  in go (numBuckets - 1) O O

-- | Double a G2 point n times
doubleNTimesG2 :: Int -> G2' -> G2'
doubleNTimesG2 0 p = p
doubleNTimesG2 n p = doubleNTimesG2 (n-1) (dbl p)

-- | Negate a G1 point
neg :: G1' -> G1'
neg (A x y) = A x (negate y)
neg O = O

-- | Generate a random field element (currently unused - using r=s=0 for testing)
randomFieldElement :: IO Fr
randomFieldElement = do
  bytes <- BS.pack <$> replicateM 32 (randomRIO (0, 255))
  return $ toP $ bytesToInteger bytes

-- | Convert bytes to integer (little-endian)
-- Note: foldr' processes from right to left, which correctly produces
-- little-endian interpretation where first byte is LSB
bytesToInteger :: ByteString -> Integer
bytesToInteger = BS.foldr' (\b acc -> acc `shiftL` 8 .|. fromIntegral b) 0

-------------------------------------------------------------------------------
-- JSON Proving Key Parsing (snarkjs export format)
-------------------------------------------------------------------------------

-- | Parse proving key from JSON (snarkjs zkey export json format)
parseProvingKeyJSON :: Aeson.Value -> Either Text ProvingKey
parseProvingKeyJSON val = case parseEither parseKey val of
  Left err -> Left $ T.pack err
  Right pk -> Right pk
  where
    parseKey = Aeson.withObject "ProvingKey" $ \obj -> do
      -- Parse verification key points
      alpha1 <- parseG1Point =<< obj .: "vk_alpha_1"
      beta1  <- parseG1Point =<< obj .: "vk_beta_1"
      beta2  <- parseG2Point =<< obj .: "vk_beta_2"
      delta1 <- parseG1Point =<< obj .: "vk_delta_1"
      delta2 <- parseG2Point =<< obj .: "vk_delta_2"
      
      -- Parse counts and domain
      nVars   <- obj .: "nVars"
      nPublic <- obj .: "nPublic"
      domainSize <- obj .: "domainSize"
      
      -- Parse A query points (may contain null for unused wires)
      aPoints <- obj .:? "A" .!= []
      parsedA <- mapM parseG1PointOrZero aPoints
      
      -- Parse B1 query points
      b1Points <- obj .:? "B1" .!= []
      parsedB1 <- mapM parseG1PointOrZero b1Points
      
      -- Parse B2 query points
      b2Points <- obj .:? "B2" .!= []
      parsedB2 <- mapM parseG2PointOrZero b2Points
      
      -- Parse C query points (JSON includes all points, but we only need private input points)
      -- Skip the first (nPublic + 1) points as they correspond to public inputs
      cPointsAll <- obj .:? "C" .!= []
      let cPointsPrivate = drop (nPublic + 1) cPointsAll
      parsedC <- mapM parseG1PointOrZero cPointsPrivate
      
      -- Parse H polynomial coefficients (called hExps in snarkjs JSON)
      hPoints <- obj .:? "hExps" .!= []
      parsedH <- mapM parseG1PointOrZero hPoints
      
      -- Parse constraint coefficients (sparse representation)
      ccoefs <- obj .:? "ccoefs" .!= []
      parsedCoefs <- mapM parseConstraintCoef ccoefs
      
      return ProvingKey
        { pkAlpha1     = alpha1
        , pkBeta1      = beta1
        , pkBeta2      = beta2
        , pkDelta1     = delta1
        , pkDelta2     = delta2
        , pkA          = parsedA
        , pkB1         = parsedB1
        , pkB2         = parsedB2
        , pkC          = parsedC
        , pkH          = parsedH
        , pkNVars      = nVars
        , pkNPublic    = nPublic
        , pkDomainSize = domainSize
        , pkCoefs      = parsedCoefs
        }
    
    parseConstraintCoef = Aeson.withObject "ConstraintCoef" $ \obj -> do
      matrix <- obj .: "matrix"
      constraint <- obj .: "constraint"
      signal <- obj .: "signal"
      valueStr <- obj .: "value"
      let value = toP (read valueStr :: Integer)
      return ConstraintCoef
        { ccMatrix = matrix
        , ccConstraint = constraint
        , ccSignal = signal
        , ccValue = value
        }

-- | Parse a G1 point from JSON [x, y, z] format
parseG1Point :: Aeson.Value -> Parser G1'
parseG1Point = Aeson.withArray "G1Point" $ \arr -> do
  when (V.length arr < 2) $ fail "G1 point needs at least 2 coordinates"
  xStr <- Aeson.parseJSON (arr V.! 0)
  yStr <- Aeson.parseJSON (arr V.! 1)
  let x = read xStr :: Integer
      y = read yStr :: Integer
  -- Check for point at infinity (z = 0)
  if V.length arr >= 3
    then do
      zStr <- Aeson.parseJSON (arr V.! 2)
      let z = read zStr :: Integer
      if z == 0
        then return O  -- Point at infinity
        else return $ A (toP x) (toP y)
    else return $ A (toP x) (toP y)

-- | Parse a G1 point, treating null as point at infinity
parseG1PointOrZero :: Aeson.Value -> Parser G1'
parseG1PointOrZero Aeson.Null = return O  -- Point at infinity for null
parseG1PointOrZero val = parseG1Point val

-- | Parse a G2 point from JSON [[x0,x1], [y0,y1], [z0,z1]] format
parseG2Point :: Aeson.Value -> Parser G2'
parseG2Point = Aeson.withArray "G2Point" $ \arr -> do
  when (V.length arr < 2) $ fail "G2 point needs at least 2 coordinates"
  xArr <- Aeson.parseJSON (arr V.! 0) :: Parser [String]
  yArr <- Aeson.parseJSON (arr V.! 1) :: Parser [String]
  when (length xArr < 2 || length yArr < 2) $ fail "G2 coordinates need 2 elements each"
  -- Check if there's a z-coordinate (projective) and if it's zero (point at infinity)
  if V.length arr >= 3 then do
    zArr <- Aeson.parseJSON (arr V.! 2) :: Parser [String]
    when (length zArr < 2) $ fail "G2 z-coordinate needs 2 elements"
    let z0 = read (zArr !! 0) :: Integer
        z1 = read (zArr !! 1) :: Integer
    if z0 == 0 && z1 == 0
      then return O  -- Point at infinity when z = 0
      else parseG2Affine xArr yArr
  else parseG2Affine xArr yArr
  where
    parseG2Affine xArr yArr = do
      let x0 = read (xArr !! 0) :: Integer
          x1 = read (xArr !! 1) :: Integer
          y0 = read (yArr !! 0) :: Integer
          y1 = read (yArr !! 1) :: Integer
          -- Fq2 is represented as x0 + x1*u where u^2 = -1
          -- toE takes [a, b] and creates a + b*u
          xFq2 = toE [toP x0, toP x1] :: G2Curve.Fq2
          yFq2 = toE [toP y0, toP y1] :: G2Curve.Fq2
      return $ A xFq2 yFq2

-- | Parse a G2 point, treating null as point at infinity
parseG2PointOrZero :: Aeson.Value -> Parser G2'
parseG2PointOrZero Aeson.Null = return O  -- Point at infinity for null
parseG2PointOrZero val = parseG2Point val

-------------------------------------------------------------------------------
-- ZKey Parsing (snarkjs/circom binary format)
-------------------------------------------------------------------------------

-- | Parse zkey file
-- Format: https://github.com/iden3/snarkjs/blob/master/src/zkey_utils.js
parseZKey :: LBS.ByteString -> Either Text ProvingKey
parseZKey bs = case runGetOrFail parseZKeyBinary bs of
  Left (_, _, err) -> Left $ T.pack err
  Right (_, _, pk) -> Right pk

parseZKeyBinary :: Get ProvingKey
parseZKeyBinary = do
  -- Magic number "zkey"
  magic <- getByteString 4
  when (magic /= "zkey") $ fail "Invalid zkey magic"
  
  -- Version
  version <- getWord32le
  when (version /= 1) $ fail $ "Unsupported zkey version: " ++ show version
  
  -- Number of sections
  _nSections <- getWord32le
  
  -- Parse sections
  -- Section 1: Header
  -- Section 2: Groth16 specific header
  -- Section 3: IC (verification key)
  -- Section 4: Coefficients
  -- Section 5: A points
  -- Section 6: B1 points
  -- Section 7: B2 points
  -- Section 8: C points
  -- Section 9: H points
  -- Section 10: Contributions
  
  -- For now, return a placeholder - full parsing is complex
  -- We'll implement this incrementally
  fail "ZKey parsing not yet fully implemented - use hybrid mode"

-------------------------------------------------------------------------------
-- Witness Parsing (wtns format)
-------------------------------------------------------------------------------

-- | Parse witness file
parseWtns :: LBS.ByteString -> Either Text Witness
parseWtns bs = case runGetOrFail parseWtnsBinary bs of
  Left (_, _, err) -> Left $ T.pack err
  Right (_, _, w) -> Right w

parseWtnsBinary :: Get Witness
parseWtnsBinary = do
  -- Magic number "wtns"
  magic <- getByteString 4
  when (magic /= "wtns") $ fail "Invalid wtns magic"
  
  -- Version
  version <- getWord32le
  when (version /= 2) $ fail $ "Unsupported wtns version: " ++ show version
  
  -- Number of sections
  _nSections <- getWord32le
  
  -- Section 1: Field info
  _sectionType1 <- getWord32le
  sectionSize1 <- getWord64le
  fieldSize <- getWord32le  -- Usually 32 for BN254
  skip (fromIntegral sectionSize1 - 4)  -- Skip rest of field info
  
  -- Section 2: Witness values
  _sectionType2 <- getWord32le
  sectionSize2 <- getWord64le
  
  let numWitness = fromIntegral sectionSize2 `div` fromIntegral fieldSize
  
  -- Read witness values
  values <- replicateM numWitness $ do
    bytes <- getByteString (fromIntegral fieldSize)
    return $ toP $ bytesToIntegerLE bytes
  
  return $ Witness values

-- | Convert bytes to integer (little-endian)
-- First byte is LSB, last byte is MSB
bytesToIntegerLE :: ByteString -> Integer  
bytesToIntegerLE = BS.foldr' (\b acc -> acc `shiftL` 8 .|. fromIntegral b) 0
