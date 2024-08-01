{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.Value where

import BlockApps.Solidity.Type
import BlockApps.Solidity.TypeDefs
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Control.DeepSeq
import qualified Data.Bimap as Bimap
import qualified Data.Binary as Binary
import Data.Bits (complement, shiftL, (.|.))
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Base16 as Base16
import qualified Data.ByteString.Lazy as ByteString.Lazy
import Data.Hashable
import qualified Data.IntMap as I
import qualified Data.Map.Strict as Map
import Data.Maybe (fromMaybe)
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Data.Traversable (for)
import Data.Word (Word8)
import GHC.Generics
import Text.Read

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

valueUInt :: Integer -> SimpleValue
valueUInt = ValueInt False Nothing

valueInt :: Integer -> SimpleValue
valueInt = ValueInt True Nothing

valueUInt256 :: Integer -> SimpleValue
valueUInt256 = ValueInt False (Just 32)

valueInt256 :: Integer -> SimpleValue
valueInt256 = ValueInt False (Just 32)

valueBytes :: ByteString -> SimpleValue
valueBytes = ValueBytes Nothing
---use this, then wrap in mapping 
data Value
  = SimpleValue SimpleValue
  | ValueArrayDynamic (I.IntMap Value) -- A sparse representation makes updates more efficient than O(n)
  | ValueArrayFixed Word [Value]
  | ValueContract NamedAccount
  | ValueEnum Text Text Word256
  | ValueFunction ByteString [(Text, Type)] [(Maybe Text, Type)]
  | ValueMapping (Map.Map SimpleValue Value)
  | ValueStruct (Map.Map Text Value)
  | ValueArraySentinel Int
  | ValueVariadic [Value]
  deriving (Eq, Show, Generic, NFData, Binary.Binary, Ord)

data SimpleValue
  = ValueBool Bool
  | ValueAddress Address
  | ValueAccount NamedAccount
  | ValueString Text
  | ValueInt
      { intSigned :: Bool,
        intSize :: Maybe Integer,
        intVal :: Integer
      }
  | ValueDecimal ByteString
  | ValueBytes
      { bytesSize :: Maybe Integer,
        bytesVal :: ByteString
      }
  deriving (Eq, Show, Generic, NFData, Binary.Binary, Ord, Hashable)

zeroOf :: Value -> Value
zeroOf = \case
  SimpleValue sv -> SimpleValue $ case sv of
    ValueBool {} -> ValueBool False
    ValueAddress {} -> ValueAddress 0x0
    ValueAccount {} -> ValueAccount $ unspecifiedChain 0x0
    ValueString {} -> ValueString ""
    ValueInt sign size _ -> ValueInt sign size 0
    ValueDecimal _ -> ValueDecimal "0"
    ValueBytes size _ -> ValueBytes size ""
  ValueContract {} -> ValueContract $ unspecifiedChain 0x0
  ValueArrayDynamic {} -> ValueArrayDynamic I.empty
  ValueMapping {} -> ValueMapping Map.empty
  ValueStruct fs -> ValueStruct $ fmap zeroOf fs
  ValueArraySentinel {} -> SimpleValue $ ValueInt True Nothing 0
  ValueArrayFixed {} -> error "default value of sized array"
  ValueFunction {} -> error "default value of function"
  ValueEnum {} -> error "default value of enum"
  ValueVariadic {} -> error "default value of variadic"

bytesToSimpleValue :: ByteString -> SimpleType -> Maybe SimpleValue
bytesToSimpleValue bs = \case
  TypeBool ->
    if (bytesToNum False (Just 1)) /= 0
      then Just $ ValueBool True
      else Just $ ValueBool False
  TypeAddress -> ValueAddress <$> stringAddress (Text.unpack . Text.decodeUtf8 $ Base16.encode bs)
  TypeAccount -> ValueAccount . unspecifiedChain <$> stringAddress (Text.unpack . Text.decodeUtf8 $ Base16.encode bs)
  TypeString -> Just $ ValueString (Text.decodeUtf8 bs)
  TypeInt s b -> Just . ValueInt s b $ bytesToNum s b
  TypeBytes b -> Just $ ValueBytes b bs
  TypeDecimal -> Just $ ValueDecimal bs
  where
    bytesToNum :: Bool -> Maybe Integer -> Integer
    bytesToNum signed' bytes' =
      if ByteString.null bs
        then 0
        else
          let bs' = ByteString.unpack bs
              h = head bs'
              neg =
                if signed'
                  then h >= 0x80
                  else False
              bys = fromMaybe 32 bytes'
              a = go neg bs' 0
           in (if neg then negate (a + 1) else a) `rem` (2 ^ (8 * bys))
    go :: Bool -> [Word8] -> Integer -> Integer
    go _ [] x = x
    go inv (w : ws) x =
      let x' = x `shiftL` 8
          w' =
            if inv
              then complement w
              else w
       in go inv ws (x' .|. toInteger w')

bytesToValue :: ByteString -> Type -> Maybe Value
bytesToValue b = \case
  SimpleType ty -> SimpleValue <$> bytesToSimpleValue b ty
  TypeArrayDynamic ty ->
    let rb = ByteString.drop 32 b
        valArray = splitBytes rb ty
     in ValueArrayDynamic . tosparse <$> sequence valArray
  TypeArrayFixed len ty ->
    let valArray = splitBytes b ty
     in ValueArrayFixed len <$> sequence valArray
  TypeContract {} -> SimpleValue <$> bytesToSimpleValue b TypeAddress
  TypeMapping {} -> Nothing -- TODO: Fixme
  TypeFunction {} -> Nothing -- TODO: Fixme
  TypeEnum {} -> Nothing -- TODO: Fixme
  TypeStruct {} -> Nothing -- TODO: Fixme
  TypeVariadic {} -> Nothing -- TODO
  where
    splitBytes b' ty
      | ByteString.null b' = []
      | otherwise = case getTypeByteLength ty of
        Nothing -> [Nothing]
        Just size ->
          let (valBytes, rb) = ByteString.splitAt size b'
           in bytesToValue valBytes ty : splitBytes rb ty

bytestringToValues :: ByteString -> [Type] -> Maybe [Value]
bytestringToValues bs ts =
  case bytesToBytesTypePair bs ts of
    Nothing -> Nothing
    Just byteTypePairs -> for byteTypePairs (uncurry bytesToValue)

bytesToBytesTypePair :: ByteString -> [Type] -> Maybe [(ByteString, Type)]
bytesToBytesTypePair totalBytes typesArr = toBytesTypePair totalBytes typesArr
  where
    toBytesTypePair _ [] = Just []
    toBytesTypePair b (_ : _) | ByteString.null b = Nothing
    toBytesTypePair b types =
      let headType = head types
          tailTypes = tail types
       in case headType of
            TypeMapping {} -> Nothing
            TypeFunction {} -> Nothing
            TypeStruct {} -> Nothing
            TypeEnum {} -> undefined -- TODO: Need to implement
            -- defaulting to wildcard to return contract address
            -- TypeContract{}      -> undefined
            TypeArrayDynamic ty -> case getTypeByteLength ty of
              Nothing -> Nothing
              Just size -> do
                let (startingByte, restOfBytes) = ByteString.splitAt 32 b
                    start = Binary.decode (ByteString.Lazy.fromStrict startingByte)
                    (lengthBytes, rb) =
                      ByteString.splitAt
                        32
                        (ByteString.drop (fromIntegral (start :: Word256)) totalBytes)
                    len = Binary.decode (ByteString.Lazy.fromStrict lengthBytes)
                    lenAsInt = fromIntegral (len :: Word256)
                    vBytes = ByteString.take (size * lenAsInt) rb
                    arrayBytes = ByteString.append lengthBytes vBytes
                rest <- toBytesTypePair restOfBytes tailTypes
                return $ (arrayBytes, headType) : rest
            SimpleType (TypeBytes Nothing) -> do
              let (startingByte, restOfBytes) = ByteString.splitAt 32 b
                  start = Binary.decode (ByteString.Lazy.fromStrict startingByte)
                  (lengthBytes, rb) =
                    ByteString.splitAt
                      32
                      (ByteString.drop (fromIntegral (start :: Word256)) totalBytes)
                  len = Binary.decode (ByteString.Lazy.fromStrict lengthBytes)
                  arrayBytes = ByteString.take (fromIntegral (len :: Word256)) rb
              rest <- toBytesTypePair restOfBytes tailTypes
              return $ (arrayBytes, headType) : rest
            SimpleType TypeString -> do
              let (startingByte, restOfBytes) = ByteString.splitAt 32 b
                  start = Binary.decode (ByteString.Lazy.fromStrict startingByte)
                  (lengthBytes, rb) =
                    ByteString.splitAt
                      32
                      (ByteString.drop (fromIntegral (start :: Word256)) totalBytes)
                  len = Binary.decode (ByteString.Lazy.fromStrict lengthBytes)
                  arrayBytes = ByteString.take (fromIntegral (len :: Word256)) rb
              rest <- toBytesTypePair restOfBytes tailTypes
              return $ (arrayBytes, headType) : rest
            _ -> case getTypeByteLength headType of -- TODO: Figure out wtf
              Nothing -> Nothing
              Just size -> do
                let (tBytes, restOfBytes) = ByteString.splitAt size b
                rest <- toBytesTypePair restOfBytes tailTypes
                return $
                  (tBytes, headType) : rest

unsparse :: I.IntMap Value -> [Value]
unsparse imap =
  let def =
        fromMaybe (error "internal error: ValueDynamicArray must be nonempty") $
          zeroOf . snd <$> I.lookupMin imap
      go _ [] = []
      go n [(_, ValueArraySentinel len)] = replicate (len - n) def
      go n kvs@((k, v) : kvs')
        | n == k = v : go (n + 1) kvs'
        | otherwise = def : go (n + 1) kvs
   in go 0 $ I.toList imap

tosparse :: [Value] -> I.IntMap Value
tosparse = I.fromList . zip [0 ..]

valueToText :: Value -> Text
valueToText = \case
  SimpleValue sv -> simpleValueToText sv
  ValueArrayDynamic vals ->
    "[" <> Text.intercalate "," (map valueToText $ unsparse vals) <> "]"
  ValueArrayFixed _ vals ->
    "[" <> Text.intercalate "," (map valueToText vals) <> "]"
  ValueMapping m ->
    let pairs = map (\(sv, v) -> simpleValueToText sv <> ": " <> valueToText v) $ Map.toList m
     in "{" <> Text.intercalate "," pairs <> "}"
  ValueContract addr -> Text.pack $ show addr
  ValueEnum {} -> error "ValueEnum to text"
  ValueFunction {} -> error "ValueFunction to text"
  ValueStruct m ->
    "{" <> Text.intercalate "," (map (\(k, v) -> Text.concat [k, ":", valueToText v]) $ Map.toList m) <> "}"
  ValueArraySentinel {} -> error "ValueArraySentinel to text"
  ValueVariadic vals ->
    "[" <> Text.intercalate "," (map valueToText vals) <> "]"

escapeStringValue :: Text -> Text
escapeStringValue = Text.replace "\"" "\\\""
                  . Text.replace "\\" "\\\\"

simpleValueToText :: SimpleValue -> Text
simpleValueToText sv = case sv of
  ValueBool tf -> if tf then "true" else "false"
  ValueAddress addr -> Text.pack $ "0x" ++ formatAddressWithoutColor addr
  ValueAccount acct -> Text.pack $ "0x" ++ show acct
  ValueString tx -> '"' `Text.cons` escapeStringValue tx `Text.snoc` '"'
  ValueInt _ _ v -> Text.pack $ show v
  ValueBytes _ b -> Text.pack $ show . Base16.encode $ b
  ValueDecimal v -> Text.pack $ show v 

textToValue :: Maybe TypeDefs -> Text -> Type -> Either Text Value
textToValue defs str = \case
  SimpleType ty -> SimpleValue <$> textToSimpleValue str ty
  TypeArrayDynamic ty ->
    ValueArrayDynamic . tosparse
      <$> traverse
        (flip (textToValue defs) ty)
        (Text.split (== ',') (Text.dropAround (\c -> c == '[' || c == ']') str))
  TypeArrayFixed len ty ->
    ValueArrayFixed len
      <$> traverse
        (flip (textToValue defs) ty)
        (Text.split (== ',') (Text.dropAround (\c -> c == '[' || c == ']') str))
  TypeMapping {} -> Left "textToValue TODO: TypeMapping not yet implemented"
  TypeFunction {} -> Left "textToValue TODO: TypeFunction not yet implemented"
  TypeContract {} ->
    ValueContract <$> case readMaybe (Text.unpack str) of
      Nothing -> Left $ "textToValue: could not decode as contract account: " <> str
      Just x -> return x
  TypeEnum name -> case defs of
    Nothing -> Left $ "Enum values cannot be parsed without type definitions" -- TODO(dustin): Pass in TypeDefs
    Just tds -> case Map.lookup name (enumDefs tds) of
      Nothing -> Left $ "Missing enum name in type definitions: " <> name
      Just eSet ->
        let str' = last $ Text.split (== '.') str
         in case Bimap.lookupR str' eSet of
              Nothing -> Left $ "Missing value '" <> str <> "' in enum definition for " <> name
              Just i -> Right $ ValueEnum name str' $ fromIntegral i
  TypeStruct {} -> Left "textToValue TODO: TypeStruct not yet implemented"
  TypeVariadic {} -> Left "textToValue TODO: TypeVariadic not yet implemented"

unEscapeStringValue :: Text -> Text
unEscapeStringValue = Text.replace "\\\"" "\""
                    . Text.replace "\\\\" "\\"  
  
textToSimpleValue :: Text -> SimpleType -> Either Text SimpleValue
textToSimpleValue str = \case
  TypeBool -> case Text.toLower str of
    "true" -> return $ ValueBool True
    "false" -> return $ ValueBool False
    _ -> Left $ "textToSimpleValue: could not decode TypeBool: " <> str
  TypeAddress ->
    ValueAddress <$> case stringAddress (Text.unpack str) of
      Nothing -> Left $ "textToSimpleValue: could not decode as address: " <> str
      Just x -> return x
  TypeAccount ->
    ValueAccount <$> case readMaybe (Text.unpack str) of
      Nothing -> Left $ "textToSimpleValue: could not decode as account: " <> str
      Just x -> return x
  TypeString -> return $ ValueString $ unEscapeStringValue str
  TypeInt s b -> ValueInt s b <$> readNum
  TypeBytes (Just n) -> ValueBytes (Just n) <$> readBytes n
  TypeBytes Nothing -> ValueBytes Nothing <$> readBytesDyn
  TypeDecimal -> Right $ ValueDecimal (Text.encodeUtf8 str)
  where
    readNum :: Either Text Integer
    readNum = case readMaybe (Text.unpack str) of
      Nothing -> Left $ "textToSimpleValue: could not decode as number: " <> str
      Just x -> return x
    readBytes :: Integer -> Either Text ByteString
    readBytes n =
      case Base16.decode (Text.encodeUtf8 str) of
        Right bytes' | ByteString.length bytes' == fromInteger n -> return bytes'
        _ -> Left $ "textToSimpleValue: could not decode as statically sized bytes: " <> str <> ", expected a Base16 encoded string of length " <> Text.pack (show $ 2 * n) <> ", which represents a bytestring of length " <> Text.pack (show n)
    readBytesDyn :: Either Text ByteString
    readBytesDyn =
      case Base16.decode (Text.encodeUtf8 str) of
        Right val -> return val
        _ -> Left $ "textToSimpleValue: could not decode as dynamically sized bytes: " <> str
