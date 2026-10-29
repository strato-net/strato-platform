{-# LANGUAGE BangPatterns #-}

module Blockchain.SolidVM.Builtins.Crypto.Metered
  ( modExp, ecAdd, ecMul, ecPairing,
    bls12381G1Add, bls12381G2Add,
    bls12381G1Msm, bls12381G2Msm, bls12381Pairing,
    bls12381G1AddInts, bls12381G2AddInts,
    bls12381G1MsmInts, bls12381G2MsmInts, bls12381PairingInts,
    mapFpToG1, mapFp2ToG2, decompressG1, decompressG2,
    hashToCurveG1, hashToCurveG2,
    poseidon, poseidon2, poseidon2Compress,
    poseidon2Permute, poseidon2Hash, poseidon2HashBytes, poseidon2gl, poseidon2glBytes,
  ) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import qualified Blockchain.SolidVM.Builtins.Crypto as Crypto
import Blockchain.SolidVM.Builtins.Gas
import Blockchain.Strato.Model.Gas (Gas)
import Blockchain.VM.SolidException (invalidArguments, typeError)
import Control.Exception (evaluate)
import Control.Monad.IO.Class (MonadIO, liftIO)
import qualified Data.ByteString as B

force :: MonadIO m => a -> m a
force = liftIO . evaluate

forcePair :: MonadIO m => (Integer, Integer) -> m (Integer, Integer)
forcePair value = do
  (!x, !y) <- force value
  pure (x, y)

forcePoint :: MonadIO m => ((Integer, Integer), (Integer, Integer)) -> m ((Integer, Integer), (Integer, Integer))
forcePoint value = do
  ((!a, !b), (!c, !d)) <- force value
  pure ((a, b), (c, d))

-- | Charge for an operation whose cost scales with the number of input
-- terms, given the flat count of integer arguments and the arity of one
-- term. Rounds up so a malformed (non-multiple) input still pays for the
-- decode attempt that is about to reject it.
chargePerTerm :: MonadBuiltinGas m => Gas -> Gas -> Int -> Int -> m ()
chargePerTerm base perTerm width count =
  chargeBuiltinGas $ max 1 (base + perTerm * fromIntegral ((count + width - 1) `div` width))

bytesResult :: (MonadIO m, Show input) => String -> input -> Either String B.ByteString -> m B.ByteString
bytesResult name input = either (\message -> invalidArguments (name ++ ": " ++ message) input) pure

modExp :: MonadBuiltinGas m => Integer -> Integer -> Integer -> m Integer
modExp b e m = do
  chargeBuiltinGas gasModExp
  _ <- traverse force [b, e, m]
  force $ Crypto.modExp b e m

ecAdd :: MonadBuiltinGas m => Integer -> Integer -> Integer -> Integer -> m (Integer, Integer)
ecAdd a b c d = do
  chargeBuiltinGas gasEcAdd
  _ <- traverse force [a, b, c, d]
  -- forced here so validation failures surface as this call's revert
  forcePair $ Crypto.ecAdd (a, b) (c, d)

ecMul :: MonadBuiltinGas m => Integer -> Integer -> Integer -> m (Integer, Integer)
ecMul a b k = do
  chargeBuiltinGas gasEcMul
  _ <- traverse force [a, b, k]
  forcePair $ Crypto.ecMul (a, b) k

-- | Charge for the pairing check, then run it. Six integers per pair.
ecPairing :: MonadBuiltinGas m => [Integer] -> m Bool
ecPairing values = do
  chargePerTerm gasEcPairingBase gasEcPairingPerPair 6 (length values)
  force $ Crypto.ecPairing values

-- | Charge for a byte-form BLS builtin, sized from the EIP-2537 input
-- length rather than an argument count.
bls12381G1Add, bls12381G2Add, bls12381G1Msm, bls12381G2Msm :: MonadBuiltinGas m => B.ByteString -> m B.ByteString
bls12381G1Add input = chargeBuiltinGas gasBlsG1Add >> bytesResult "bls12381G1Add" input (Crypto.bls12381G1Add input)
bls12381G2Add input = chargeBuiltinGas gasBlsG2Add >> bytesResult "bls12381G2Add" input (Crypto.bls12381G2Add input)
  -- 160 bytes per (G1 point, scalar) term
bls12381G1Msm input = chargePerTerm 0 gasBlsG1MsmPerTerm 160 (B.length input) >> bytesResult "bls12381G1Msm" input (Crypto.bls12381G1Msm input)
  -- 288 bytes per (G2 point, scalar) term
bls12381G2Msm input = chargePerTerm 0 gasBlsG2MsmPerTerm 288 (B.length input) >> bytesResult "bls12381G2Msm" input (Crypto.bls12381G2Msm input)

bls12381Pairing :: MonadBuiltinGas m => B.ByteString -> m Bool
bls12381Pairing input = do
  -- 384 bytes per (G1, G2) pair
  chargePerTerm gasBlsPairingBase gasBlsPairingPerPair 384 (B.length input)
  either (\message -> invalidArguments ("bls12381Pairing: " ++ message) input) pure (Crypto.bls12381Pairing input)

bls12381G1AddInts :: MonadBuiltinGas m => Integer -> Integer -> Integer -> Integer -> m (Integer, Integer)
bls12381G1AddInts a b c d = do
  chargeBuiltinGas gasBlsG1Add
  _ <- traverse force [a, b, c, d]
  forcePair $ Crypto.bls12381G1AddInts (a, b) (c, d)

bls12381G2AddInts :: MonadBuiltinGas m => Integer -> Integer -> Integer -> Integer -> Integer -> Integer -> Integer -> Integer -> m ((Integer, Integer), (Integer, Integer))
bls12381G2AddInts a b c d e f g h = do
  chargeBuiltinGas gasBlsG2Add
  _ <- traverse force [a, b, c, d, e, f, g, h]
  forcePoint $ Crypto.bls12381G2AddInts ((a, b), (c, d)) ((e, f), (g, h))

-- | Pack a flat list of SolidVM ints into G1MSM @(x, y, k)@ triples and
--   call the pure helper. Errors out if the arg count isn't a multiple of 3.
bls12381G1MsmInts :: MonadBuiltinGas m => [Integer] -> m (Integer, Integer)
bls12381G1MsmInts values = do
  chargePerTerm 0 gasBlsG1MsmPerTerm 3 (length values)
  ints <- traverse force values
  triples <- maybe (invalidArguments "bls12381G1Msm: expected a multiple of 3 integer args (x, y, k per term)" values) pure (chunks ints)
  forcePair $ Crypto.bls12381G1MsmInts triples
  where
    chunks [] = Just []
    chunks (a:b:c:rest) = ((a,b,c):) <$> chunks rest
    chunks _ = Nothing

-- | Pack flat ints into G2MSM @(((xc0, xc1), (yc0, yc1)), k)@ entries.
--   Each term is 5 ints (4 coordinates + 1 scalar).
bls12381G2MsmInts :: MonadBuiltinGas m => [Integer] -> m ((Integer, Integer), (Integer, Integer))
bls12381G2MsmInts values = do
  chargePerTerm 0 gasBlsG2MsmPerTerm 5 (length values)
  ints <- traverse force values
  terms <- maybe (invalidArguments "bls12381G2Msm: expected a multiple of 5 integer args (xc0, xc1, yc0, yc1, k per term)" values) pure (chunks ints)
  forcePoint $ Crypto.bls12381G2MsmInts terms
  where
    chunks [] = Just []
    chunks (a:b:c:d:e:rest) = ((((a,b),(c,d)),e):) <$> chunks rest
    chunks _ = Nothing

-- | Pack flat ints into pairing-check @(g1, g2)@ pairs. Each pair is 6
--   ints: G1 (x, y) + G2 ((xc0, xc1), (yc0, yc1)).
bls12381PairingInts :: MonadBuiltinGas m => [Integer] -> m Bool
bls12381PairingInts values = do
  chargePerTerm gasBlsPairingBase gasBlsPairingPerPair 6 (length values)
  ints <- traverse force values
  pairs <- maybe (invalidArguments "bls12381Pairing: expected a multiple of 6 integer args (G1.x, G1.y, G2.xc0, G2.xc1, G2.yc0, G2.yc1 per term)" values) pure (chunks ints)
  force $ Crypto.bls12381PairingInts pairs
  where
    chunks [] = Just []
    chunks (a:b:c:d:e:f:rest) = (((a,b),((c,d),(e,f))):) <$> chunks rest
    chunks _ = Nothing

mapFpToG1, mapFp2ToG2, decompressG1, decompressG2 :: MonadBuiltinGas m => B.ByteString -> m B.ByteString
mapFpToG1 input = chargeBuiltinGas gasBlsMapFpToG1 >> bytesResult "bls12381MapFpToG1" input (Crypto.mapFpToG1 input)
mapFp2ToG2 input = chargeBuiltinGas gasBlsMapFp2ToG2 >> bytesResult "bls12381MapFp2ToG2" input (Crypto.mapFp2ToG2 input)
decompressG1 input = chargeBuiltinGas gasBlsDecompressG1 >> bytesResult "bls12381DecompressG1" input (Crypto.decompressG1 input)
decompressG2 input = chargeBuiltinGas gasBlsDecompressG2 >> bytesResult "bls12381DecompressG2" input (Crypto.decompressG2 input)

-- hash_to_curve runs two map-to-curve passes plus expand_message_xmd over
-- the message, so it is charged as the map plus a per-message-block term.
hashToCurveG1, hashToCurveG2 :: MonadBuiltinGas m => B.ByteString -> B.ByteString -> m B.ByteString
hashToCurveG1 message dst = chargePerTerm (2 * gasBlsMapFpToG1) 100 32 (B.length message) >> bytesResult "bls12381HashToCurveG1" [message, dst] (Crypto.hashToCurveG1 message dst)
hashToCurveG2 message dst = chargePerTerm (2 * gasBlsMapFp2ToG2) 100 32 (B.length message) >> bytesResult "bls12381HashToCurveG2" [message, dst] (Crypto.hashToCurveG2 message dst)

-- | Charge for a Poseidon hash, then run it. Cost scales with the number
-- of field elements absorbed; the arity bound is enforced after charging
-- so an oversized call still pays for the attempt.
poseidon, poseidon2 :: MonadBuiltinGas m => [Integer] -> m Integer
poseidon values = do
  chargeBuiltinGas $ gasPoseidonBase + gasPoseidonPerInput * fromIntegral (max 1 $ length values)
  if null values || length values > 8
    then typeError "invalid args passed to poseidon" (show values)
    else traverse force values >>= force . Crypto.poseidonHash
-- | Poseidon2 is Merkle-Damgard over a 2-to-1 compression, so it runs one
-- permutation per input element and has no arity cap.
poseidon2 values = do
  chargeBuiltinGas $ gasPoseidonBase + gasPoseidonPerInput * fromIntegral (max 1 $ length values)
  if null values
    then typeError "invalid args passed to poseidon2" (show values)
    else traverse force values >>= force . Crypto.poseidon2Hash

poseidon2Compress :: MonadBuiltinGas m => Integer -> Integer -> m Integer
poseidon2Compress a b = do
  chargeBuiltinGas $ gasPoseidonBase + gasPoseidonPerInput
  _ <- traverse force [a, b]
  force $ Crypto.poseidon2Compress a b

-- | Resolve a parametrized-Poseidon2 params block, rejecting unknown instances.
poseidon2Instance :: Monad m => B.ByteString -> m Crypto.P2Instance
poseidon2Instance input = either (invalidArguments "poseidon2 params") pure (Crypto.parsePoseidon2Params input)

poseidon2GasFor :: MonadBuiltinGas m => Crypto.P2Instance -> Int -> Int -> m ()
poseidon2GasFor inst nIn nOut = case inst of
  Crypto.P2BN254 -> chargeBuiltinGas $ gasPoseidonBase + gasPoseidonPerInput * fromIntegral (max 1 nIn)
  Crypto.P2Goldilocks12 -> chargeBuiltinGas $ gasPoseidon2GLBase + gasPoseidon2GLPerPerm * fromIntegral (Crypto.poseidon2Permutations inst nIn nOut)

poseidon2Permute :: MonadBuiltinGas m => B.ByteString -> [Integer] -> m [Integer]
poseidon2Permute params values = do
  inst <- poseidon2Instance params
  poseidon2GasFor inst 1 1
  ints <- traverse force values
  force $ Crypto.poseidon2Permute inst ints

poseidon2Hash :: MonadBuiltinGas m => B.ByteString -> [Integer] -> Integer -> m [Integer]
poseidon2Hash params values n = do
  inst <- poseidon2Instance params
  let nOut = fromIntegral n
  poseidon2GasFor inst (length values) nOut
  ints <- traverse force values
  force $ Crypto.poseidon2ParamHash inst nOut ints

poseidon2HashBytes :: MonadBuiltinGas m => B.ByteString -> B.ByteString -> Integer -> m [Integer]
poseidon2HashBytes params input n = do
  inst <- poseidon2Instance params
  let nOut = fromIntegral n
      chunk = if inst == Crypto.P2Goldilocks12 then 7 else 31
      nIn = (B.length input + chunk - 1) `div` chunk + 1
  poseidon2GasFor inst nIn nOut
  force $ Crypto.poseidon2ParamHashBytes inst nOut input

-- Named wrappers for the Goldilocks instance: 4-element digests.
poseidon2gl :: MonadBuiltinGas m => [Integer] -> m [Integer]
poseidon2gl values = poseidon2Hash Crypto.poseidon2ParamsGoldilocks values 4

poseidon2glBytes :: MonadBuiltinGas m => B.ByteString -> m [Integer]
poseidon2glBytes input = poseidon2HashBytes Crypto.poseidon2ParamsGoldilocks input 4
