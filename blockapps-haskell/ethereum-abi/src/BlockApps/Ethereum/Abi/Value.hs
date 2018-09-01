{-# LANGUAGE LambdaCase #-}

module BlockApps.Ethereum.Abi.Value
  ( Value(..)
  , valueIsDynamic
  , validValue
  , encodeValue
  , encodeValues
  , decodeValue
  , decodeValues
  ) where

import           Data.Bool                   (bool)
import           Data.ByteString             (ByteString)
import           Data.LargeInt
import           Network.Haskoin.Crypto
import           Data.Maybe
import           Data.Monoid
import           Data.Text                   (Text)
import           Data.Traversable

import qualified Data.Binary                 as Binary
import qualified Data.ByteString             as ByteString
import qualified Data.ByteString.Lazy        as ByteString.Lazy
import qualified Data.Text.Encoding          as Text.Encoding

import           BlockApps.Ethereum
import           BlockApps.Ethereum.Abi.Type

data Value
  = ValueBool Bool
  | ValueUInt Word256
  | ValueInt Int256
  | ValueAddress Address
  -- | ValueFixed
  -- | ValueUFixed
  | ValueBytesStatic ByteString
  | ValueBytesDynamic ByteString
  | ValueString Text
  | ValueArrayStatic [Value]
  | ValueArrayDynamic [Value]
  deriving (Eq,Show)

valueIsDynamic :: Value -> Bool
valueIsDynamic = \case
  ValueBool _ -> False
  ValueUInt _ -> False
  ValueInt _ -> False
  ValueAddress _ -> False
  ValueBytesStatic _ -> False
  ValueBytesDynamic _ -> True
  ValueString _ -> True
  ValueArrayStatic vals -> any valueIsDynamic vals
  ValueArrayDynamic _ -> True

validValue :: Type -> Value -> Bool
validValue ty' val' = validType ty' && case (ty',val') of
  (TypeBool, ValueBool _) -> True
  (TypeUInt Nothing, ValueUInt _) -> True
  (TypeUInt (Just n), ValueUInt x) -> n == 256 || x <= 2^n - 1
  (TypeInt Nothing, ValueInt _) -> True
  (TypeInt (Just n), ValueInt x) -> n == 256 ||
    (negate x <= 2^(n-1) && x <= 2^(n-1) - 1)
  (TypeAddress,ValueAddress _) -> True
  (TypeBytesStatic len, ValueBytesStatic bytes) ->
    ByteString.length bytes == len
  (TypeBytesDynamic, ValueBytesDynamic _) -> True
  (TypeString, ValueString _) -> True
  (TypeArrayStatic len ty, ValueArrayStatic vals) ->
    length vals == len && all (validValue ty) vals
  (TypeArrayDynamic ty, ValueArrayDynamic vals) -> all (validValue ty) vals
  _ -> False

encodeValue :: Value -> ByteString
encodeValue = \case
  ValueBool value -> encodeValue . ValueUInt $ bool 0 1 value
  ValueUInt value -> encodeStrict value
  ValueInt value -> encodeStrict value
  ValueAddress value ->
    encodeValue . ValueUInt . fromIntegral $ unAddress value
  ValueBytesStatic value -> padRight value
  ValueBytesDynamic value -> padRight $
    encodeLength (ByteString.length value) <> value
  ValueString value ->
    encodeValue . ValueBytesDynamic $ Text.Encoding.encodeUtf8 value
  ValueArrayStatic values -> encodeValues values
  ValueArrayDynamic values ->
    encodeLength (length values) <> encodeValues values
  where
    encodeStrict x = ByteString.Lazy.toStrict $ Binary.encode x
    padRight bs =
      let
        len = ByteString.length bs
        padSize = (32 - (len `mod` 32)) `mod` 32
        padding = ByteString.replicate padSize 0
      in
        bs <> padding

encodeValues :: [Value] -> ByteString
encodeValues values =
  let
    head' =
      [ if valueIsDynamic value then Nothing else Just (encodeValue value)
      | value <- values
      ]
    tail' =
      [ if valueIsDynamic value then encodeValue value else ByteString.empty
      | value <- values
      ]
    tailLens = scanl (\len bytes -> len + ByteString.length bytes) 0 tail'
    headLen = sum $ map (maybe 32 ByteString.length) head'
    head'' = zipWith (fromMaybe . encodeLength . (headLen +)) tailLens head'
  in
    ByteString.concat $ head'' <> tail'

decodeValue :: ByteString -> Type -> Maybe Value
decodeValue bytes = \case
  TypeBool -> do
    ValueUInt n <- decodeValue bytes (TypeUInt Nothing)
    return . ValueBool $ n /= 0
  TypeUInt _ -> ValueUInt <$> decodeStrict bytes
  TypeInt _ -> ValueInt <$> decodeStrict bytes
  TypeAddress -> do
    ValueUInt addr <- decodeValue bytes (TypeUInt Nothing)
    return . ValueAddress . Address $ fromIntegral addr
  TypeBytesStatic len ->
    return . ValueBytesStatic $ ByteString.take len bytes
  TypeBytesDynamic -> do
    let (bytesLen,bytesRest) = ByteString.splitAt 32 bytes
    len <- decodeLength bytesLen
    ValueBytesStatic rest <- decodeValue bytesRest (TypeBytesStatic len)
    return $ ValueBytesDynamic rest
  TypeString -> do
    ValueBytesDynamic str <- decodeValue bytes TypeBytesDynamic
    return . ValueString $ Text.Encoding.decodeUtf8 str
  TypeArrayStatic len ty ->
    ValueArrayStatic <$> decodeValues bytes (replicate len ty)
  TypeArrayDynamic ty -> do
    let (bytesLen,bytesRest) = ByteString.splitAt 32 bytes
    len <- decodeLength bytesLen
    ValueArrayStatic rest <- decodeValue bytesRest (TypeArrayStatic len ty)
    return $ ValueArrayDynamic rest
  where
    decodeStrict bytes' =
      case Binary.decodeOrFail (ByteString.Lazy.fromStrict bytes') of
        Left _        -> Nothing
        Right (_,_,y) -> Just y

decodeValues :: ByteString -> [Type] -> Maybe [Value]
decodeValues bytes tys' = do
  head' <- decodeHead headBytes' tys'
  for (zip head' (tailLens head')) $ \case
    (Left (start,ty),end) -> do
      let chunk = ByteString.drop start $ ByteString.take end bytes
      decodeValue chunk ty
    (Right val,_) -> return val
  where
    bytesLen = ByteString.length bytes
    tailLens head' = tail $
      scanr (either (const . fst) (const id)) bytesLen head'
    paddedLen len = 32 + 32 * ((len - 1) `div` 32)
    headLen = sum (map (paddedLen . fromMaybe 32 . typeByteSize) tys')
    headBytes' = ByteString.take headLen bytes
    decodeHead headBytes = \case
      [] -> return []
      ty:tys -> case typeByteSize ty of
        Nothing -> do
          let (tailLenBytes,restBytes) = ByteString.splitAt 32 headBytes
          tailLen <- decodeLength tailLenBytes
          rest <- decodeHead restBytes tys
          return $ Left (tailLen,ty) : rest
        Just len -> do
          let
            (valBytes,restBytes) =
              ByteString.splitAt (paddedLen len) headBytes
          val <- decodeValue valBytes ty
          rest <- decodeHead restBytes tys
          return $ Right val : rest

encodeLength :: Int -> ByteString
encodeLength = encodeValue . ValueUInt . fromIntegral

decodeLength :: ByteString -> Maybe Int
decodeLength bytes = do
  ValueUInt len <- decodeValue bytes (TypeUInt Nothing)
  return $ fromIntegral len
