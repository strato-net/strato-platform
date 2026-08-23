{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins
  ( -- * Monadic ABI functions (need MonadSM)
    encodeDynamicValue,
    abiEncode,
    abiEncodePacked,

    -- * Non-ABI builtins
    push,
    modExp,
    ecAdd,
    ecMul,
    ecPairing,
    poseidonHash,
    poseidon2Hash,
    poseidon2Compress,
    -- * Parametrized Poseidon2 (EIP-5988-shaped params, registry of vetted instances)
    P2Instance (..),
    parsePoseidon2Params,
    poseidon2ParamsGoldilocks,
    poseidon2ParamsBN254,
    poseidon2Permute,
    poseidon2ParamHash,
    poseidon2ParamHashBytes,
    poseidon2Permutations,

    -- * BLS12-381 (EIP-2537 parity)
    --
    --   Two parallel APIs: the @bytes@-shaped builtins below match
    --   EIP-2537's input layout exactly so callers porting EVM code can
    --   feed precompile bytes through verbatim. The @*Ints@ siblings
    --   take field elements as raw integers/tuples for SolidVM-native
    --   ergonomics.
    bls12381G1Add,
    bls12381G1Msm,
    bls12381G2Add,
    bls12381G2Msm,
    bls12381Pairing,
    bls12381G1AddInts,
    bls12381G1MsmInts,
    bls12381G2AddInts,
    bls12381G2MsmInts,
    bls12381PairingInts,

    -- * Map-to-curve (EIP-2537 §BLS12_MAP_FP_TO_G1, §BLS12_MAP_FP2_TO_G2)
    --
    --   Take pre-derived F_p / F_p^2 inputs. Useful when the contract
    --   already has the field elements and just needs the map step.
    mapFpToG1,
    mapFp2ToG2,

    -- * Full hash-to-curve (RFC 9380 §3 / §6.6.3)
    --
    --   These compose 'expand_message_xmd' (SHA-256) +
    --   'hash_to_field' + map-to-curve + cofactor clearing into a
    --   single call. Suite mappings:
    --
    --     hashToCurveG1 = BLS12381G1_XMD:SHA-256_SSWU_RO_
    --     hashToCurveG2 = BLS12381G2_XMD:SHA-256_SSWU_RO_
    --
    --   For Ethereum sync-committee BLS verification, callers pass
    --   the signing root as @msg@ and
    --   @"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_"@ as @dst@.
    hashToCurveG1,
    hashToCurveG2,

    -- * Point compression / decompression (IETF / ZCash format)
    --
    --   Beacon-chain APIs return BLS points in their compressed form
    --   (G1: 48 bytes, G2: 96 bytes). EIP-2537 / SolidVM precompiles
    --   consume the uncompressed forms (G1: 128 bytes, G2: 256 bytes).
    --   These bridge the two so contracts can take what the wire
    --   provides and feed it into 'bls12381Pairing' directly.
    decompressG1,
    decompressG2,
  )
where

import Blockchain.SolidVM.BLS12381
  ( bls12381G1Add,
    bls12381G1AddInts,
    bls12381G1Msm,
    bls12381G1MsmInts,
    bls12381G2Add,
    bls12381G2AddInts,
    bls12381G2Msm,
    bls12381G2MsmInts,
    bls12381Pairing,
    bls12381PairingInts,
  )
import Blockchain.SolidVM.BLS12381.Compress
  ( decompressG1,
    decompressG2,
  )
import Blockchain.SolidVM.BLS12381.HashToCurve
  ( hashToCurveG1,
    hashToCurveG2,
    mapFp2ToG2,
    mapFpToG1,
  )

import BlockApps.Solidity.ABI.Codec
import Blockchain.SolidVM.SM
import Blockchain.SolidVM.SetGet
import Blockchain.Strato.Model.Address (addressToByteString)
import Blockchain.VM.SolidException
import Control.Monad ((<=<))
import qualified Crypto.Hash.Poseidon as Poseidon
import Crypto.Hash.Poseidon.Field (fieldPrime)
import qualified Crypto.Hash.Poseidon2 as Poseidon2
import qualified Crypto.Hash.Poseidon2Goldilocks as P2GL
import Data.Bits (shiftL, shiftR, (.|.))
import Data.Word (Word64)
import Data.Curve                   (Form(Weierstrass), Coordinates(Affine), dbl, def)
import Data.Curve.Weierstrass.BN254 (BN254, Fq, Fr, Point(..), add, mul, _q, _r)
import qualified Data.Curve.Weierstrass.BN254T as BN254T
import Data.Foldable (fold)
import Data.Maybe (isNothing)
import Data.Pairing.Ate             (finalExponentiationBN, millerAlgorithmBN)
import Data.Pairing.BN254           (Fq2, G2', GT', parameterBin, parameterHex)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Vector as V
import GHC.Exts (IsList(fromList))
import qualified SolidVM.Model.Storable as MS
import SolidVM.Model.Value

-- Pushes a new value to an array and returns the length of the new array
push :: MonadSM m => Value -> Maybe Variable -> ValList -> m Variable
push (SReference apt) _ vals = do
  let av = case vals of
             [] -> SNULL
             (a:_) -> a
      lenPath = apt `MS.snoc` MS.Field "length"
  len' <- getInt $ Constant $ SReference lenPath
  let len :: Int = fromIntegral len'
      newLen = SInteger $ fromIntegral $ len + 1
      idxPath = apt `MS.snoc` MS.Index (BC.pack $ show len)
  setVar (Constant (SReference lenPath)) newLen
  setVar (Constant (SReference idxPath)) av
  return $ Constant newLen
push (SArray vec) (Just (Variable ref)) vals = do
  let av = case vals of
             [] -> SNULL
             (a:_) -> a
  newVar <- createVar av
  let newArr = V.snoc vec newVar
  setVar (Variable ref) (SArray newArr)
  return $ Constant (SInteger $ fromIntegral $ V.length newArr)
push v mv argVals = do
  invalidArguments "push" (v, mv, argVals)

modExp :: Integer -> Integer -> Integer -> Integer
modExp _ _ 0 = 0 -- EIP-198: a zero modulus yields zero
modExp _ e _ | e < 0 = invalidArguments "modExp" ("negative exponent" :: String)
modExp b e m =
  case (b, e, even e) of
    (_, 0, _) -> 1 -- 0^0 == 1, per EIP-198
    (0, _, _) -> 0
    (_, _, True) ->
      let y = modExp b (e `div` 2) m
        in (y * y) `mod` m
    (_, _, False) ->
      b * (modExp b (e - 1) m) `mod` m

-- | BN254 base field modulus @p@ and subgroup order @r@, for validating raw
-- integer inputs before they are reduced into field elements.
bnP :: Integer
bnP = toInteger _q

bnR :: Integer
bnR = toInteger _r

outOfRange :: Integer -> Bool
outOfRange c = c < 0 || c >= bnP

-- | Decode an affine G1 point with EIP-196 validation: coordinates must be
-- canonical (@0 <= c < p@) and satisfy the curve equation; (0, 0) denotes
-- the point at infinity. G1 has cofactor 1, so no subgroup check is needed.
g1Point :: String -> (Integer, Integer) -> Point Weierstrass Affine BN254 Fq Fr
g1Point caller (x, y)
  | outOfRange x || outOfRange y =
      invalidArguments caller $ "G1 coordinate out of range [0, p): " ++ show (x, y)
  | x == 0 && y == 0 = O
  | def p = p
  | otherwise = invalidArguments caller $ "G1 point is not on the curve: " ++ show (x, y)
  where
    p :: Point Weierstrass Affine BN254 Fq Fr
    p = A (fromInteger x) (fromInteger y)

-- | Decode an affine G2 point on the twist with EIP-197 validation:
-- canonical coordinates, on-curve, and in the r-order subgroup. The twist
-- has a large cofactor, so on-curve alone is not sufficient: pairing a
-- non-subgroup G2 point can satisfy a verifier's pairing equation with a
-- forged proof.
g2Point :: String -> ((Integer, Integer), (Integer, Integer)) -> G2'
g2Point caller ((xr, xi), (yr, yi))
  | any outOfRange [xr, xi, yr, yi] =
      invalidArguments caller $ "G2 coordinate out of range [0, p): " ++ show ((xr, xi), (yr, yi))
  | all (== 0) [xr, xi, yr, yi] = O
  | not (g2OnTwist x y) =
      invalidArguments caller $ "G2 point is not on the twist curve: " ++ show ((xr, xi), (yr, yi))
  | not (g2InSubgroup (x, y)) =
      invalidArguments caller $ "G2 point is not in the r-order subgroup: " ++ show ((xr, xi), (yr, yi))
  | otherwise = A x y
  where
    toFq2 :: (Integer, Integer) -> Fq2
    toFq2 (u, v) = fromList [fromInteger u, fromInteger v]
    x = toFq2 (xr, xi)
    y = toFq2 (yr, yi)

-- The elliptic-curve fork provides no Curve instance for the twist (G2
-- points are only ever constructed raw and fed to `pairing`), so the two
-- validation predicates are implemented directly over Fq2.

-- | The twist equation: y^2 = x^3 + b' with b' = 3/(9+u).
g2OnTwist :: Fq2 -> Fq2 -> Bool
g2OnTwist x y = y * y == x * x * x + BN254T._b

-- | A point on the twist is in the r-order subgroup iff [r]P is the point
-- at infinity; the twist's full group order is r * h with a ~254-bit
-- cofactor h.
g2InSubgroup :: (Fq2, Fq2) -> Bool
g2InSubgroup = isNothing . go bnR . Just
  where
    -- affine double-and-add; Nothing is the point at infinity
    go :: Integer -> Maybe (Fq2, Fq2) -> Maybe (Fq2, Fq2)
    go 0 _ = Nothing
    go _ Nothing = Nothing
    go k p =
      let half = go (k `div` 2) (g2Dbl =<< p)
       in if odd k then g2AddAff p half else half
    g2AddAff :: Maybe (Fq2, Fq2) -> Maybe (Fq2, Fq2) -> Maybe (Fq2, Fq2)
    g2AddAff Nothing q = q
    g2AddAff p Nothing = p
    g2AddAff (Just p1@(x1, y1)) (Just (x2, y2))
      | x1 /= x2 =
          let l = (y2 - y1) / (x2 - x1)
              x3 = l * l - x1 - x2
           in Just (x3, l * (x1 - x3) - y1)
      | y1 == y2 && y1 /= 0 = g2Dbl p1
      | otherwise = Nothing
    g2Dbl :: (Fq2, Fq2) -> Maybe (Fq2, Fq2)
    g2Dbl (x, y)
      | y == 0 = Nothing
      | otherwise =
          let l = (3 * x * x) / (2 * y)
              x3 = l * l - 2 * x
           in Just (x3, l * (x - x3) - y)

unpoint :: Point Weierstrass Affine BN254 Fq Fr -> (Integer, Integer)
unpoint (A x y) = (toInteger x, toInteger y)
unpoint O       = (0, 0)

ecAdd :: (Integer, Integer) -> (Integer, Integer) -> (Integer, Integer)
ecAdd p1 p2 =
  let q1 = g1Point "ecAdd" p1
      q2 = g1Point "ecAdd" p2
      -- the affine `add` is incomplete addition (P + P yields O); Ethereum's
      -- ecAdd precompile doubles, so dispatch to dbl on equal points
   in unpoint (if q1 == q2 then dbl q1 else add q1 q2)

ecMul :: (Integer, Integer) -> Integer -> (Integer, Integer)
ecMul p s = unpoint (mul (g1Point "ecMul" p) (fromInteger s :: Fr))

ecPairing :: [Integer] -> Bool
ecPairing = doPairing . toTrios
  -- Ethereum orders the coordinates as x1, y1, x2Imag, x2Real, y2Imag, y2Real
  -- so toTrios regroups them to ((x1, y1), ((x2Real, x2Imag), (y2Real, y2Imag))),
  -- which is the order in which pairing library (and poly library under the hood) expects
  where toTrios (a:b:c:d:e:f:g) = ((a, b), ((d, c), (f, e))) : toTrios g
        toTrios [] = []
        toTrios _ = invalidArguments "ecPairing" ("input length must be a multiple of 6" :: String)
        doPairing trios =
          let -- a pair containing the point at infinity contributes the
              -- identity, so it is validated but excluded from the product
              millers :: [GT']
              millers =
                [ millerAlgorithmBN twistXi parameterBin p1 p2
                | (c1, c2) <- trios
                , let p1 = g1Point "ecPairing" c1
                , let p2 = g2Point "ecPairing" c2
                , p1 /= O
                , p2 /= O
                ]
           in -- The final exponentiation is a group homomorphism, so
              -- FE(a) * FE(b) = FE(a * b): accumulate the Miller loop
              -- outputs first and exponentiate once, rather than once per
              -- pair as `pairing` would. A Groth16/PLONK verify passes four
              -- pairs, and the final exponentiation dominates the cost, so
              -- this is roughly a 4x saving on every proof verification.
              null millers || finalExponentiationBN parameterHex (mconcat millers) == mempty

-- | The BN254 twist constant @xi = 9 + u@, defining @Fq6 = Fq2[v]/(v^3 - xi)@.
-- The pairing library uses this internally but doesn't export it, and
-- 'millerAlgorithmBN' takes it as a parameter. It's a fixed curve constant,
-- not an implementation detail — and 'ecPairing' is cross-checked against
-- the library's own @pairing@ in the test suite, so a divergence would fail
-- loudly rather than silently producing wrong verification results.
twistXi :: Fq2
twistXi = fromList [9, 1]

-- | Poseidon hash - ZK-friendly hash function over BN254 scalar field
-- Takes a list of integers (field elements) and returns their Poseidon hash
poseidonHash :: [Integer] -> Integer
poseidonHash inputs = Poseidon.fromF $ Poseidon.poseidon (map Poseidon.toF inputs)

-- | Poseidon2 hash (gnark-crypto BN254 defaults: t=2, rF=6, rP=50):
-- Merkle–Damgård over the 2-to-1 compression, matching gnark circuits'
-- @std/hash/poseidon2@ gadget. Inputs must be canonical field elements —
-- silently reducing them would hash a different preimage than the caller's
-- circuit sees.
poseidon2Hash :: [Integer] -> Integer
poseidon2Hash = Poseidon.fromF . Poseidon2.hash . map (canonicalF "poseidon2")

-- | The raw gnark Poseidon2 2-to-1 compression (right-input feed-forward),
-- the node function for Merkle trees in gnark circuits.
poseidon2Compress :: Integer -> Integer -> Integer
poseidon2Compress l r =
  Poseidon.fromF $
    Poseidon2.compress (canonicalF "poseidon2Compress" l) (canonicalF "poseidon2Compress" r)

--------------------------------------------------------------------------------
-- Parametrized Poseidon2
--------------------------------------------------------------------------------

-- | A vetted Poseidon2 instance. Instances are SELECTED by a parameter
-- block, never derived from it: the deployed Poseidon2s people need to
-- interoperate with (gnark-crypto's BN254, plonky2/Plonky3's Goldilocks,
-- ...) each fix their round constants by a different procedure, so a
-- precompile that derived constants from (p, t, alpha, rounds) would match
-- none of them. The parameter block follows EIP-5988's shape so a future
-- Ethereum precompile can be shimmed onto the same dispatch:
--
-- @
--   [variant: 1 B = 2 (Poseidon2)][p: 32 B big-endian][t: 1 B][alpha: 1 B]
--   [R_F: 1 B][R_P: 1 B][mode: 1 B]                              (38 bytes)
-- @
--
-- mode 1 = Merkle–Damgård over the 2-to-1 compression (t = 2 instances,
-- output 1 element); mode 0 = plonky2-style sponge (absorb t-4 per
-- permutation by overwrite, no padding, squeeze n outputs).
data P2Instance
  = P2BN254 -- ^ gnark-crypto defaults: t=2, alpha=5, R_F=6, R_P=50, MD mode
  | P2Goldilocks12 -- ^ plonky2/Plonky3: t=12, alpha=7, R_F=8, R_P=22, sponge (rate 8)
  deriving (Eq, Show)

goldilocksPrimeInteger :: Integer
goldilocksPrimeInteger = toInteger P2GL.goldilocksPrime

encodeP2Params :: Integer -> Int -> Int -> Int -> Int -> Int -> B.ByteString
encodeP2Params p t alpha rF rP mode =
  B.pack $ [2] ++ be32 p ++ map fromIntegral [t, alpha, rF, rP, mode]
  where
    be32 v = [fromIntegral ((v `shiftR` (8 * i)) `mod` 256) | i <- [31, 30 .. 0]]

-- | The parameter blocks of the registered instances (what a contract passes).
poseidon2ParamsBN254, poseidon2ParamsGoldilocks :: B.ByteString
poseidon2ParamsBN254 = encodeP2Params fieldPrime 2 5 6 50 1
poseidon2ParamsGoldilocks = encodeP2Params goldilocksPrimeInteger 12 7 8 22 0

parsePoseidon2Params :: B.ByteString -> Either String P2Instance
parsePoseidon2Params b
  | B.length b /= 38 = Left "poseidon2 params must be 38 bytes: variant|p(32)|t|alpha|R_F|R_P|mode"
  | b == poseidon2ParamsBN254 = Right P2BN254
  | b == poseidon2ParamsGoldilocks = Right P2Goldilocks12
  | otherwise = Left "unregistered poseidon2 instance (known: BN254 t=2/5/6/50 MD, Goldilocks t=12/7/8/22 sponge)"

instanceWidth :: P2Instance -> Int
instanceWidth P2BN254 = 2
instanceWidth P2Goldilocks12 = 12

canonicalGL :: String -> Integer -> Word64
canonicalGL caller v
  | v < 0 || v >= goldilocksPrimeInteger =
      invalidArguments caller $ "input is not a canonical Goldilocks element: " ++ show v
  | otherwise = fromInteger v

-- | The raw permutation on a full state (t elements).
poseidon2Permute :: P2Instance -> [Integer] -> [Integer]
poseidon2Permute inst st
  | length st /= instanceWidth inst =
      invalidArguments "poseidon2Permute" $ "state must have " ++ show (instanceWidth inst) ++ " elements"
poseidon2Permute P2BN254 [a, b] =
  let (x, y) = Poseidon2.permutation (canonicalF "poseidon2Permute" a, canonicalF "poseidon2Permute" b)
   in [Poseidon.fromF x, Poseidon.fromF y]
poseidon2Permute P2Goldilocks12 st = map toInteger . P2GL.permutation $ map (canonicalGL "poseidon2Permute") st
poseidon2Permute _ st = invalidArguments "poseidon2Permute" $ show st

-- | Hash inputs to n outputs in the instance's mode.
poseidon2ParamHash :: P2Instance -> Int -> [Integer] -> [Integer]
poseidon2ParamHash P2BN254 n xs
  | n /= 1 = invalidArguments "poseidon2Hash" ("the BN254 MD instance produces exactly one output" :: String)
  | otherwise = [poseidon2Hash xs]
poseidon2ParamHash P2Goldilocks12 n xs
  | n < 1 || n > 12 = invalidArguments "poseidon2Hash" ("output count must be in [1, 12]" :: String)
  | otherwise = map toInteger . P2GL.hashNToM n $ map (canonicalGL "poseidon2Hash") xs

-- | Hash a byte string: pack it into canonical elements — little-endian
-- chunks of floor((bits(p) - 1) / 8) bytes (Goldilocks: 7, BN254: 31), the
-- last zero-padded — followed by ONE element holding the byte length (so
-- payloads that differ only in trailing zeros commit differently), then
-- hash as 'poseidon2ParamHash'. For Goldilocks this is exactly the STRATO
-- rollup's DA commitment (rollup/perp3 DACommit).
poseidon2ParamHashBytes :: P2Instance -> Int -> B.ByteString -> [Integer]
poseidon2ParamHashBytes P2Goldilocks12 n bs = map toInteger $ P2GL.hashBytes n bs
poseidon2ParamHashBytes P2BN254 n bs = poseidon2ParamHash P2BN254 n (packLE 31 bs ++ [toInteger (B.length bs)])

packLE :: Int -> B.ByteString -> [Integer]
packLE k bs
  | B.null bs = []
  | otherwise =
      let (c, rest) = B.splitAt k bs
       in foldr (\w acc -> (acc `shiftL` 8) .|. toInteger w) 0 (B.unpack c) : packLE k rest

-- | How many permutations a hash of @n@ inputs with @m@ outputs performs
-- (the gas driver): sponge absorbs t-4 per permutation and squeezes t-4 per
-- permutation; MD does one compression per input.
poseidon2Permutations :: P2Instance -> Int -> Int -> Int
poseidon2Permutations P2BN254 nIn _ = max 1 nIn
poseidon2Permutations P2Goldilocks12 nIn nOut =
  let rate = 8
      absorb = max 1 ((nIn + rate - 1) `div` rate)
      squeeze = max 0 ((nOut - 1) `div` rate)
   in absorb + squeeze

canonicalF :: String -> Integer -> Poseidon.F
canonicalF caller v
  | v < 0 || v >= fieldPrime =
      invalidArguments caller $ "input is not a canonical field element in [0, r): " ++ show v
  | otherwise = Poseidon.toF v

--------------------------------------------------------------------------------
-- Monadic ABI functions (need MonadSM for variable dereferencing)
--------------------------------------------------------------------------------

encodeDynamicValue :: MonadSM m => Value -> m B.ByteString
encodeDynamicValue (SBytes bs) = pure $
  encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeDynamicValue (SString s) = pure $
  let bs = BC.pack s
  in encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeDynamicValue (SArray vec) = do
  elems <- traverse weakGetVar (V.toList vec)
  encoded <- abiEncode elems
  pure $ encodeUint256 (fromIntegral $ length elems) <> encoded
encodeDynamicValue v = pure $ encodeStaticValue v

-- | Standard ABI encoding of a list of values.
-- Uses head/tail encoding: static values go directly in the head,
-- dynamic values get an offset pointer in the head and data in the tail.
abiEncode :: MonadSM m => [Value] -> m B.ByteString
abiEncode vals = do
  let n = length vals
      headSize = n * 32
      -- Build head and tail simultaneously
      go [] _ headAcc tailAcc = pure (headAcc, tailAcc)
      go (v:vs) tailOffset headAcc tailAcc
        | isDynamicValue v = do
            encoded <- encodeDynamicValue v
            let offsetWord = encodeUint256 (fromIntegral tailOffset)
            go vs (tailOffset + B.length encoded) (headAcc <> offsetWord) (tailAcc <> encoded)
        | otherwise =
            go vs tailOffset (headAcc <> encodeStaticValue v) tailAcc
  uncurry (<>) <$> go vals headSize B.empty B.empty

-- | Packed ABI encoding — no padding, no offsets.
abiEncodePacked :: MonadSM m => [Value] -> m B.ByteString
abiEncodePacked = fmap fold . traverse encodeValuePacked
  where
    encodeValuePacked :: MonadSM m => Value -> m B.ByteString
    encodeValuePacked (SBool True)       = pure $ B.singleton 1
    encodeValuePacked (SBool False)      = pure $ B.singleton 0
    encodeValuePacked (SAddress addr _)  = pure $ addressToByteString addr
    encodeValuePacked (SInteger n)       = pure $ encodeInt256 n
    encodeValuePacked (SString s)        = pure $ BC.pack s
    encodeValuePacked (SBytes bs)        = pure bs
    encodeValuePacked (SEnumVal _ _ w)   = pure $ encodeUint256 (fromIntegral w)
    encodeValuePacked (SArray vec)       = fold <$> traverse (encodeValuePacked <=< weakGetVar) vec
    encodeValuePacked SNULL              = pure B.empty
    encodeValuePacked _                  = pure B.empty
