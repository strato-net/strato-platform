{-# LANGUAGE GADTs, OverloadedStrings, LambdaCase, CPP, DataKinds, TypeOperators #-}
-- Builtins are ordinary actions. Selection happens while compiling the call.
module SolidVM.Builtins where

import Blockchain.Data.RLP
import Blockchain.Data.Transaction (whoSignedThisTransactionEcrecover)
import Blockchain.Data.Util (integer2Bytes)
import qualified Blockchain.SolidVM.Exception as E
import qualified Blockchain.SolidVM.Builtins as Crypto
import Blockchain.SolidVM.GasInfo
import Blockchain.Strato.Model.Gas (Gas (..))
import Blockchain.Strato.Model.Address (Address (..), unAddress)
import Blockchain.Strato.Model.ExtendedWord (word160ToBytes)
import Blockchain.Strato.Model.Keccak256
import Control.Exception (throwIO)
import Control.Monad.Reader
import qualified Crypto.Hash.SHA256 as SHA256
import qualified Crypto.Hash.RIPEMD160 as RIPEMD160
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Decimal
import Data.Foldable (toList)
import Data.List (sortOn)
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import Numeric (showHex)
import SolidVM.Core
import Text.Printf (printf)
import Text.Read (readEither, readMaybe)

flatten :: [Dyn] -> [Dyn]
flatten ds = case reverse ds of
  Dyn TVariadic rest : xs -> reverse xs ++ rest
  _ -> ds

bad :: T.Text -> [Dyn] -> M a
bad name ds = liftIO $ throwIO $ E.InvalidArguments (T.unpack name) (show (map showDyn ds))

missingUserCert :: M a
missingUserCert = liftIO $ throwIO $ E.UnknownVariable "not found" "getUserCert"

invalidLowLevel :: [Dyn] -> M a
invalidLowLevel ds = liftIO $ throwIO $ E.TypeError "low-level call needs first argument to be a string" (show (map showDyn ds))

modular :: (Integer -> Integer -> Integer) -> [Dyn] -> M Dyn
modular op ds = case flatten ds of
  [Dyn TInt a, Dyn TInt b, Dyn TInt c]
    | c == 0 -> liftIO $ throwIO $ E.DivideByZero "modular arithmetic"
    | otherwise -> pure $ Dyn TInt (op a b `mod` c)
  xs -> bad "modular arithmetic expects three integers" xs

parseInteger :: T.Text -> Integer -> M Integer
parseInteger s 10 = either (const $ bad "invalid decimal integer" [Dyn TStr s]) pure (readEither (T.unpack s))
parseInteger s 16 = do
  let hex = fromMaybe s (T.stripPrefix "0x" s)
      padded = if odd (T.length hex) then "0" <> hex else hex
  case B16.decode (TE.encodeUtf8 padded) of
    Right bs -> pure $ bytesInteger bs
    Left _ -> bad "invalid hexadecimal integer" [Dyn TStr s]
parseInteger s base = bad "unsupported integer base" [Dyn TStr s, Dyn TInt base]

bytesInteger :: B.ByteString -> Integer
bytesInteger = B.foldl' (\n w -> n * 256 + fromIntegral w) 0

integer :: [Dyn] -> M Dyn
integer ds = fmap (Dyn TInt) $ case flatten ds of
  [Dyn TInt n] -> pure n
  [Dyn (TEnum _ _) n] -> pure (enumNumber n)
  [Dyn TDecimal n] -> pure (decimalMantissa (roundTo 0 n))
  [Dyn TStr s] -> parseInteger s 16
  [Dyn TStr s, Dyn TInt base] -> parseInteger s base
  [Dyn TBytes bs] -> pure (bytesInteger bs)
  [Dyn TAddr a] -> pure (fromIntegral (unAddress a))
  [Dyn TUnit ()] -> pure 0
  [Dyn (TRef _) _] -> pure 0
  xs -> bad "integer cast" xs

decimal :: [Dyn] -> M Dyn
decimal ds = fmap (Dyn TDecimal) $ case flatten ds of
  [Dyn TInt n] -> pure (fromInteger n)
  [Dyn TDecimal n] -> pure n
  [Dyn TStr s] -> maybe (bad "decimal cast" ds) pure (readMaybe (T.unpack s))
  [Dyn TUnit ()] -> pure 0
  [Dyn (TRef _) _] -> pure 0
  xs -> bad "decimal cast" xs

address :: [Dyn] -> M Dyn
address ds = fmap (Dyn TAddr) $ case flatten ds of
  [Dyn TAddr a] -> pure a
  [Dyn (TContract _) a] -> pure a
  [Dyn TInt n] -> pure (Address (fromInteger n))
  [Dyn TBytes bs] -> pure (Address (fromInteger (bytesInteger bs)))
  [Dyn TStr s] -> maybe (bad "address cast" ds) pure (readMaybe (T.unpack s))
  [Dyn TUnit ()] -> pure (Address 0)
  [Dyn (TRef _) _] -> pure (Address 0)
  xs -> bad "address cast" xs

string :: [Dyn] -> M Dyn
string ds = fmap (Dyn TStr) $ case flatten ds of
  [Dyn TStr s] -> pure s
  [Dyn TAddr a] -> pure (T.pack (show a))
  [Dyn TInt n] -> pure (T.pack (show n))
  [Dyn TInt n, Dyn TInt 10] -> pure (T.pack (show n))
  [Dyn TInt n, Dyn TInt 16] -> pure ("0x" <> T.pack (showHex n ""))
  [Dyn TInt n, Dyn TInt 16, Dyn TInt width] -> pure (T.pack (printf ("0x%0" ++ show (2 * width) ++ "x") n))
  [Dyn TBool b] -> pure (if b then "true" else "false")
  [Dyn TBytes bs] -> pure (either (const (T.pack (BC.unpack bs))) id (TE.decodeUtf8' bs))
  [Dyn TBytes bs, Dyn TStr "raw"] -> pure (T.pack (BC.unpack bs))
  [Dyn TBytes bs, Dyn TStr "utf-8"] -> either (const (bad "bytestring is not UTF-8 encoded" ds)) pure (TE.decodeUtf8' bs)
  [Dyn TUnit ()] -> pure ""
  [Dyn (TRef _) _] -> pure ""
  xs -> bad "string cast" xs

encode :: Bool -> [Dyn] -> M Dyn
encode packed ds = do
  runtime <- rt
  Dyn TBytes <$> liftIO (rtAbiEncode runtime packed (flatten ds))

destroy :: [Dyn] -> M Dyn
destroy ds = case flatten ds of
  [d] -> do
    addr <- address [d] >>= fromDyn TAddr
    runtime <- rt
    Dyn TBool <$> liftIO (rtSelfdestruct runtime addr)
  xs -> bad "selfdestruct" xs

create :: Bool -> [Dyn] -> M Dyn
create salted ds = case (salted, flatten ds) of
  (False, Dyn TStr name : Dyn TStr source : args) -> deploy Nothing name source args
  (True, salt : Dyn TStr name : Dyn TStr source : args) -> deploy (Just salt) name source args
  (_, xs) -> bad "create expects contract name and source" xs
  where
    deploy salt name source args
      | T.null name || T.null source = bad "empty contract name or source" ds
      | otherwise = do
          runtime <- rt
          Dyn TAddr <$> liftIO (rtCreateCode runtime salt name source args)

derive :: Address -> [Dyn] -> M Address
derive creator ds = case flatten ds of
  Dyn TStr salt : Dyn TStr name : args -> do
    runtime <- rt
    liftIO (rtDerive runtime creator salt name args)
  xs -> bad "derive expects salt and contract name" xs

recover :: [Dyn] -> M Dyn
recover ds = case flatten ds of
  [h, Dyn TInt v, r, s] -> do
    bs <- hashBytes h
    ri <- integer [r] >>= fromDyn TInt
    si <- integer [s] >>= fromDyn TInt
    pure $ Dyn TAddr $ fromMaybe (Address 0) $ whoSignedThisTransactionEcrecover (unsafeCreateKeccak256FromByteString bs) ri si v
  xs -> bad "ecrecover" xs
  where
    hashBytes :: Dyn -> M B.ByteString
    hashBytes (Dyn TBytes bs) = pure bs
    hashBytes (Dyn TInt n) = pure (integer2Bytes n)
    hashBytes (Dyn TAddr a) = pure (B.pack (word160ToBytes (unAddress a)))
    hashBytes (Dyn TStr s) = pure (either (const (TE.encodeUtf8 s)) id (B16.decode (TE.encodeUtf8 s)))
    hashBytes (Dyn TUnit ()) = pure B.empty
    hashBytes d = bad "ecrecover hash" [d]

keccak :: [Dyn] -> M Dyn
keccak ds = case flatten ds of
  [Dyn TBytes bs] -> pure (Dyn TBytes (keccak256ToByteString (hash bs)))
  xs -> pure (Dyn TStr (T.pack (keccak256ToHex (hash (rlpSerialize (encodeValues xs))))))

digest :: (B.ByteString -> B.ByteString) -> [Dyn] -> M Dyn
digest hashBytes ds = pure $ case flatten ds of
  [Dyn TBytes bs] -> Dyn TBytes (hashBytes bs)
  xs -> Dyn TStr (TE.decodeUtf8 (B16.encode (hashBytes (rlpSerialize (encodeValues xs)))))

sha256, ripemd160 :: [Dyn] -> M Dyn
sha256 = digest SHA256.hash
ripemd160 = digest RIPEMD160.hash

cryptoResult :: Ty a -> T.Text -> [Dyn] -> Either String a -> M Dyn
cryptoResult ty name ds = either (\message -> bad (name <> ": " <> T.pack message) ds) (pure . Dyn ty)

chargeCrypto :: Gas -> M ()
chargeCrypto (Gas amount) = chargeGas amount

chargeCryptoBlocks :: Gas -> Gas -> Int -> Int -> M ()
chargeCryptoBlocks base perBlock blockSize size =
  chargeCrypto (base + perBlock * fromIntegral ((size + blockSize - 1) `div` blockSize))

cryptoBytes :: T.Text -> Gas -> (B.ByteString -> Either String B.ByteString) -> [Dyn] -> M Dyn
cryptoBytes name gas action ds = case flatten ds of
  [Dyn TBytes bs] -> chargeCrypto gas >> cryptoResult TBytes name ds (action bs)
  xs -> bad name xs

blsDecompressG1, blsDecompressG2, blsMapFpToG1, blsMapFp2ToG2 :: [Dyn] -> M Dyn
blsDecompressG1 = cryptoBytes "bls12381DecompressG1" gasBlsDecompressG1 Crypto.decompressG1
blsDecompressG2 = cryptoBytes "bls12381DecompressG2" gasBlsDecompressG2 Crypto.decompressG2
blsMapFpToG1 = cryptoBytes "bls12381MapFpToG1" gasBlsMapFpToG1 Crypto.mapFpToG1
blsMapFp2ToG2 = cryptoBytes "bls12381MapFp2ToG2" gasBlsMapFp2ToG2 Crypto.mapFp2ToG2

blsHashToCurve :: T.Text -> Gas -> (B.ByteString -> B.ByteString -> Either String B.ByteString) -> [Dyn] -> M Dyn
blsHashToCurve name gas action ds = case flatten ds of
  [Dyn TBytes message, Dyn TBytes dst] -> do
    chargeCryptoBlocks (2 * gas) 100 32 (B.length message)
    cryptoResult TBytes name ds (action message dst)
  xs -> bad name xs

blsHashToCurveG1, blsHashToCurveG2 :: [Dyn] -> M Dyn
blsHashToCurveG1 = blsHashToCurve "bls12381HashToCurveG1" gasBlsMapFpToG1 Crypto.hashToCurveG1
blsHashToCurveG2 = blsHashToCurve "bls12381HashToCurveG2" gasBlsMapFp2ToG2 Crypto.hashToCurveG2

integerValues :: [Dyn] -> [Dyn]
integerValues [Dyn (TArr ty) xs] = map (Dyn ty) (toList xs)
integerValues [Dyn TWireArray xs] = xs
integerValues ds = flatten ds

integerArgs :: [Dyn] -> M [Integer]
integerArgs = traverse value . integerValues
  where
    value :: Dyn -> M Integer
    value (Dyn TInt n) = pure n
    value (Dyn TUnit ()) = pure 0
    value (Dyn (TRef _) _) = pure 0
    value d = bad "expected an integer" [d]

pointG1 :: (Integer, Integer) -> Dyn
pointG1 (x, y) = Dyn (TTuple (FCons "" TInt (FCons "" TInt FNil))) (x :* y :* HNil)

pointG2 :: ((Integer, Integer), (Integer, Integer)) -> Dyn
pointG2 ((xc0, xc1), (yc0, yc1)) =
  Dyn (TTuple (FCons "" TInt (FCons "" TInt (FCons "" TInt (FCons "" TInt FNil))))) (xc0 :* xc1 :* yc0 :* yc1 :* HNil)

blsG1Add, blsG2Add :: [Dyn] -> M Dyn
blsG1Add ds = case flatten ds of
  [Dyn TBytes _] -> cryptoBytes "bls12381G1Add" gasBlsG1Add Crypto.bls12381G1Add ds
  xs -> do
    chargeCrypto gasBlsG1Add
    values <- integerArgs xs
    case values of
      [x1, y1, x2, y2] -> pure $ pointG1 (Crypto.bls12381G1AddInts (x1, y1) (x2, y2))
      _ -> bad "bls12381G1Add expects four integers" xs
blsG2Add ds = case flatten ds of
  [Dyn TBytes _] -> cryptoBytes "bls12381G2Add" gasBlsG2Add Crypto.bls12381G2Add ds
  xs -> do
    chargeCrypto gasBlsG2Add
    values <- integerArgs xs
    case values of
      [a, b, c, d, e, f, g, h] -> pure $ pointG2 (Crypto.bls12381G2AddInts ((a, b), (c, d)) ((e, f), (g, h)))
      _ -> bad "bls12381G2Add expects eight integers" xs

blsG1Msm, blsG2Msm, blsPairing :: [Dyn] -> M Dyn
blsG1Msm ds = case flatten ds of
  [Dyn TBytes bs] -> do
    chargeCryptoBlocks 0 gasBlsG1MsmPerTerm 160 (B.length bs)
    cryptoResult TBytes "bls12381G1Msm" ds (Crypto.bls12381G1Msm bs)
  xs -> do
    chargeCryptoBlocks 0 gasBlsG1MsmPerTerm 3 (length (integerValues xs))
    values <- integerArgs xs
    terms <- triples values
    pure $ pointG1 (Crypto.bls12381G1MsmInts terms)
  where
    triples [] = pure []
    triples (x:y:k:rest) = ((x, y, k) :) <$> triples rest
    triples _ = bad "bls12381G1Msm expects triples" ds
blsG2Msm ds = case flatten ds of
  [Dyn TBytes bs] -> do
    chargeCryptoBlocks 0 gasBlsG2MsmPerTerm 288 (B.length bs)
    cryptoResult TBytes "bls12381G2Msm" ds (Crypto.bls12381G2Msm bs)
  xs -> do
    chargeCryptoBlocks 0 gasBlsG2MsmPerTerm 5 (length (integerValues xs))
    values <- integerArgs xs
    terms <- quintuples values
    pure $ pointG2 (Crypto.bls12381G2MsmInts terms)
  where
    quintuples [] = pure []
    quintuples (a:b:c:d:k:rest) = ((((a, b), (c, d)), k) :) <$> quintuples rest
    quintuples _ = bad "bls12381G2Msm expects groups of five integers" ds
blsPairing ds = case flatten ds of
  [Dyn TBytes bs] -> do
    chargeCryptoBlocks gasBlsPairingBase gasBlsPairingPerPair 384 (B.length bs)
    cryptoResult TBool "bls12381Pairing" ds (Crypto.bls12381Pairing bs)
  xs -> do
    chargeCryptoBlocks gasBlsPairingBase gasBlsPairingPerPair 6 (length (integerValues xs))
    values <- integerArgs xs
    terms <- pairs values
    pure $ Dyn TBool (Crypto.bls12381PairingInts terms)
  where
    pairs [] = pure []
    pairs (a:b:c:d:e:f:rest) = (((a, b), ((c, d), (e, f))) :) <$> pairs rest
    pairs _ = bad "bls12381Pairing expects groups of six integers" ds

encodeValues :: [Dyn] -> RLPObject
encodeValues [d] = encodeValue d
encodeValues ds = RLPArray (map encodeValue ds)

encodeValue :: Dyn -> RLPObject
encodeValue (Dyn ty v) = case ty of
  TInt -> rlpEncode v
  TDecimal -> rlpEncode (show v)
  TBool -> rlpEncode v
  TAddr -> rlpEncode v
  TStr -> rlpEncode (T.unpack v)
  TBytes -> rlpEncode v
  TEnum _ _ -> rlpEncode (enumNumber v)
  TWireEnum _ _ -> rlpEncode v
  TStruct _ fs -> RLPArray (map (encodeValue . snd) (sortOn fst (fields fs v)))
  TTuple fs -> RLPArray (map encodeValue (toDyns fs v))
  TArr et -> RLPArray (map (encodeValue . Dyn et) (toList v))
  TWireArray -> RLPArray (map encodeValue v)
  TVariadic -> encodeValues v
  TRaw -> case v of [] -> rlpEncode (0 :: Integer); _ -> encodeValues v
  TUnit -> rlpEncode (0 :: Integer)
  TRef _ -> rlpEncode (0 :: Integer)
  _ -> RLPArray []
  where
    fields :: Fields ts -> HL ts -> [(T.Text, Dyn)]
    fields FNil HNil = []
    fields (FCons n t rest) (x :* xs) = (n, Dyn t x) : fields rest xs

lookupAction :: T.Text -> Maybe ([Dyn] -> M Dyn)
lookupAction =
#include "BuiltinActions.inc"
