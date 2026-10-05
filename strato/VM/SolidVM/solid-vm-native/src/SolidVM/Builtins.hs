{-# LANGUAGE GADTs, OverloadedStrings, LambdaCase #-}
-- Builtins are ordinary actions. Selection happens while compiling the call.
module SolidVM.Builtins (lookupAction, derive, missingUserCert, invalidLowLevel) where

import Blockchain.Data.RLP
import Blockchain.Data.Transaction (whoSignedThisTransactionEcrecover)
import Blockchain.Data.Util (integer2Bytes)
import qualified Blockchain.SolidVM.Exception as E
import Blockchain.Strato.Model.Address (Address (..), unAddress)
import Blockchain.Strato.Model.ExtendedWord (word160ToBytes)
import Blockchain.Strato.Model.Keccak256
import Control.Exception (throwIO)
import Control.Monad.Reader
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

lookupAction :: T.Text -> Maybe ([Dyn] -> M Dyn)
lookupAction = \case
  "keccak256" -> Just keccak
  "ecrecover" -> Just recover
  "addmod" -> Just (modular (+))
  "mulmod" -> Just (modular (*))
  "string" -> Just string
  "decimal" -> Just decimal
  "int" -> Just integer
  "address" -> Just address
  "abiEncode" -> Just (encode False)
  "abiEncodePacked" -> Just (encode True)
  "selfdestruct" -> Just destroy
  "create" -> Just (create False)
  "create2" -> Just (create True)
  _ -> Nothing

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
