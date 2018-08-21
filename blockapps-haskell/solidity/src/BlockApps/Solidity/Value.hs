{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.Value where


import           Control.Monad           (sequence)
import qualified Data.Bimap              as Bimap
import           Data.Binary             (Binary)
import qualified Data.Binary             as Binary
import           Data.ByteString         (ByteString)
import qualified Data.ByteString         as ByteString
import qualified Data.ByteString.Base16  as Base16
import qualified Data.ByteString.Lazy    as ByteString.Lazy
import           Data.List               (intersperse)
import           Data.Monoid
import qualified Data.Map.Strict         as Map
import           Data.Text               (Text)
import qualified Data.Text               as Text
import qualified Data.Text.Encoding      as Text
import           Data.Traversable        (for)
import           Text.Read

import           BlockApps.Ethereum
import           BlockApps.Solidity.Int
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.TypeDefs

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

data Value
  = SimpleValue SimpleValue
  | ValueArrayDynamic [Value]
  | ValueArrayFixed Word [Value]
  | ValueContract Address
  | ValueEnum Text Text Word256
  | ValueFunction ByteString [(Text, Type)] [(Maybe Text, Type)]
  -- | ValueMapping (Map SimpleValue Value)
  | ValueStruct [(Text, Value)]
  deriving (Show)

data SimpleValue
  = ValueBool Bool
  | ValueUInt8 Word8
  | ValueUInt16 Word16
  | ValueUInt24 Word24
  | ValueUInt32 Word32
  | ValueUInt40 Word40
  | ValueUInt48 Word48
  | ValueUInt56 Word56
  | ValueUInt64 Word64
  | ValueUInt72 Word72
  | ValueUInt80 Word80
  | ValueUInt88 Word88
  | ValueUInt96 Word96
  | ValueUInt104 Word104
  | ValueUInt112 Word112
  | ValueUInt120 Word120
  | ValueUInt128 Word128
  | ValueUInt136 Word136
  | ValueUInt144 Word144
  | ValueUInt152 Word152
  | ValueUInt160 Word160
  | ValueUInt168 Word168
  | ValueUInt176 Word176
  | ValueUInt184 Word184
  | ValueUInt192 Word192
  | ValueUInt200 Word200
  | ValueUInt208 Word208
  | ValueUInt216 Word216
  | ValueUInt224 Word224
  | ValueUInt232 Word232
  | ValueUInt240 Word240
  | ValueUInt248 Word248
  | ValueUInt256 Word256
  | ValueUInt Word256
  | ValueInt8 Int8
  | ValueInt16 Int16
  | ValueInt24 Int24
  | ValueInt32 Int32
  | ValueInt40 Int40
  | ValueInt48 Int48
  | ValueInt56 Int56
  | ValueInt64 Int64
  | ValueInt72 Int72
  | ValueInt80 Int80
  | ValueInt88 Int88
  | ValueInt96 Int96
  | ValueInt104 Int104
  | ValueInt112 Int112
  | ValueInt120 Int120
  | ValueInt128 Int128
  | ValueInt136 Int136
  | ValueInt144 Int144
  | ValueInt152 Int152
  | ValueInt160 Int160
  | ValueInt168 Int168
  | ValueInt176 Int176
  | ValueInt184 Int184
  | ValueInt192 Int192
  | ValueInt200 Int200
  | ValueInt208 Int208
  | ValueInt216 Int216
  | ValueInt224 Int224
  | ValueInt232 Int232
  | ValueInt240 Int240
  | ValueInt248 Int248
  | ValueInt256 Int256
  | ValueInt Int256
  | ValueAddress Address
  -- | ValueFixed
  -- | ValueUFixed
  | ValueBytes1 Word8
  | ValueBytes2 ByteString
  | ValueBytes3 ByteString
  | ValueBytes4 ByteString
  | ValueBytes5 ByteString
  | ValueBytes6 ByteString
  | ValueBytes7 ByteString
  | ValueBytes8 ByteString
  | ValueBytes9 ByteString
  | ValueBytes10 ByteString
  | ValueBytes11 ByteString
  | ValueBytes12 ByteString
  | ValueBytes13 ByteString
  | ValueBytes14 ByteString
  | ValueBytes15 ByteString
  | ValueBytes16 ByteString
  | ValueBytes17 ByteString
  | ValueBytes18 ByteString
  | ValueBytes19 ByteString
  | ValueBytes20 ByteString
  | ValueBytes21 ByteString
  | ValueBytes22 ByteString
  | ValueBytes23 ByteString
  | ValueBytes24 ByteString
  | ValueBytes25 ByteString
  | ValueBytes26 ByteString
  | ValueBytes27 ByteString
  | ValueBytes28 ByteString
  | ValueBytes29 ByteString
  | ValueBytes30 ByteString
  | ValueBytes31 ByteString
  | ValueBytes32 ByteString
  | ValueBytes ByteString
  | ValueString Text
    deriving (Show)


bytesToSimpleValue :: ByteString -> SimpleType -> Maybe SimpleValue
bytesToSimpleValue b = \case
  TypeBool -> if (bytesToNum::Int) == 1
    then Just $ ValueBool True
    else Just $ ValueBool False
  TypeUInt8 -> Just $ ValueUInt8 bytesToNum
  TypeUInt16 -> Just $ ValueUInt16 bytesToNum
  TypeUInt24 -> Just $ ValueUInt24 bytesToNum
  TypeUInt32 -> Just $ ValueUInt32 bytesToNum
  TypeUInt40 -> Just $ ValueUInt40 bytesToNum
  TypeUInt48 -> Just $ ValueUInt48 bytesToNum
  TypeUInt56 -> Just $ ValueUInt56 bytesToNum
  TypeUInt64 -> Just $ ValueUInt64 bytesToNum
  TypeUInt72 -> Just $ ValueUInt72 bytesToNum
  TypeUInt80 -> Just $ ValueUInt80 bytesToNum
  TypeUInt88 -> Just $ ValueUInt88 bytesToNum
  TypeUInt96 -> Just $ ValueUInt96 bytesToNum
  TypeUInt104 -> Just $ ValueUInt104 bytesToNum
  TypeUInt112 -> Just $ ValueUInt112 bytesToNum
  TypeUInt120 -> Just $ ValueUInt120 bytesToNum
  TypeUInt128 -> Just $ ValueUInt128 bytesToNum
  TypeUInt136 -> Just $ ValueUInt136 bytesToNum
  TypeUInt144 -> Just $ ValueUInt144 bytesToNum
  TypeUInt152 -> Just $ ValueUInt152 bytesToNum
  TypeUInt160 -> Just $ ValueUInt160 bytesToNum
  TypeUInt168 -> Just $ ValueUInt168 bytesToNum
  TypeUInt176 -> Just $ ValueUInt176 bytesToNum
  TypeUInt184 -> Just $ ValueUInt184 bytesToNum
  TypeUInt192 -> Just $ ValueUInt192 bytesToNum
  TypeUInt200 -> Just $ ValueUInt200 bytesToNum
  TypeUInt208 -> Just $ ValueUInt208 bytesToNum
  TypeUInt216 -> Just $ ValueUInt216 bytesToNum
  TypeUInt224 -> Just $ ValueUInt224 bytesToNum
  TypeUInt232 -> Just $ ValueUInt232 bytesToNum
  TypeUInt240 -> Just $ ValueUInt240 bytesToNum
  TypeUInt248 -> Just $ ValueUInt248 bytesToNum
  TypeUInt256 -> Just $ ValueUInt256 bytesToNum
  TypeUInt -> Just $ ValueUInt bytesToNum
  TypeInt8 -> Just $ ValueInt8 bytesToNum
  TypeInt16 -> Just $ ValueInt16 bytesToNum
  TypeInt24 -> Just $ ValueInt24 bytesToNum
  TypeInt32 -> Just $ ValueInt32 bytesToNum
  TypeInt40 -> Just $ ValueInt40 bytesToNum
  TypeInt48 -> Just $ ValueInt48 bytesToNum
  TypeInt56 -> Just $ ValueInt56 bytesToNum
  TypeInt64 -> Just $ ValueInt64 bytesToNum
  TypeInt72 -> Just $ ValueInt72 bytesToNum
  TypeInt80 -> Just $ ValueInt80 bytesToNum
  TypeInt88 -> Just $ ValueInt88 bytesToNum
  TypeInt96 -> Just $ ValueInt96 bytesToNum
  TypeInt104 -> Just $ ValueInt104 bytesToNum
  TypeInt112 -> Just $ ValueInt112 bytesToNum
  TypeInt120 -> Just $ ValueInt120 bytesToNum
  TypeInt128 -> Just $ ValueInt128 bytesToNum
  TypeInt136 -> Just $ ValueInt136 bytesToNum
  TypeInt144 -> Just $ ValueInt144 bytesToNum
  TypeInt152 -> Just $ ValueInt152 bytesToNum
  TypeInt160 -> Just $ ValueInt160 bytesToNum
  TypeInt168 -> Just $ ValueInt168 bytesToNum
  TypeInt176 -> Just $ ValueInt176 bytesToNum
  TypeInt184 -> Just $ ValueInt184 bytesToNum
  TypeInt192 -> Just $ ValueInt192 bytesToNum
  TypeInt200 -> Just $ ValueInt200 bytesToNum
  TypeInt208 -> Just $ ValueInt208 bytesToNum
  TypeInt216 -> Just $ ValueInt216 bytesToNum
  TypeInt224 -> Just $ ValueInt224 bytesToNum
  TypeInt232 -> Just $ ValueInt232 bytesToNum
  TypeInt240 -> Just $ ValueInt240 bytesToNum
  TypeInt248 -> Just $ ValueInt248 bytesToNum
  TypeInt256 -> Just $ ValueInt256 bytesToNum
  TypeInt -> Just $ ValueInt bytesToNum
  TypeAddress -> ValueAddress <$>  stringAddress (Text.unpack . Text.decodeUtf8 $ Base16.encode b)
  TypeBytes1 -> Just $ ValueBytes1 $ ByteString.head b
  TypeBytes2 -> Just $ ValueBytes2 b
  TypeBytes3 -> Just $ ValueBytes3 b
  TypeBytes4 -> Just $ ValueBytes4 b
  TypeBytes5 -> Just $ ValueBytes5 b
  TypeBytes6 -> Just $ ValueBytes6 b
  TypeBytes7 -> Just $ ValueBytes7 b
  TypeBytes8 -> Just $ ValueBytes8 b
  TypeBytes9 -> Just $ ValueBytes9 b
  TypeBytes10 -> Just $ ValueBytes10 b
  TypeBytes11 -> Just $ ValueBytes11 b
  TypeBytes12 -> Just $ ValueBytes12 b
  TypeBytes13 -> Just $ ValueBytes13 b
  TypeBytes14 -> Just $ ValueBytes14 b
  TypeBytes15 -> Just $ ValueBytes15 b
  TypeBytes16 -> Just $ ValueBytes16 b
  TypeBytes17 -> Just $ ValueBytes17 b
  TypeBytes18 -> Just $ ValueBytes18 b
  TypeBytes19 -> Just $ ValueBytes19 b
  TypeBytes20 -> Just $ ValueBytes20 b
  TypeBytes21 -> Just $ ValueBytes21 b
  TypeBytes22 -> Just $ ValueBytes22 b
  TypeBytes23 -> Just $ ValueBytes23 b
  TypeBytes24 -> Just $ ValueBytes24 b
  TypeBytes25 -> Just $ ValueBytes25 b
  TypeBytes26 -> Just $ ValueBytes26 b
  TypeBytes27 -> Just $ ValueBytes27 b
  TypeBytes28 -> Just $ ValueBytes28 b
  TypeBytes29 -> Just $ ValueBytes29 b
  TypeBytes30 -> Just $ ValueBytes30 b
  TypeBytes31 -> Just $ ValueBytes31 b
  TypeBytes32 -> Just $ ValueBytes32 b
  TypeBytes -> Just $ ValueBytes b
  TypeString -> Just $ ValueString (Text.decodeUtf8 b)
  where
    bytesToNum :: (Binary x, Num x) => x
    bytesToNum = fromIntegral (Binary.decode (ByteString.Lazy.fromStrict b)::Int256)

bytesToValue :: ByteString -> Type -> Maybe Value
bytesToValue b = \case
  SimpleType ty       -> SimpleValue <$> bytesToSimpleValue b ty
  TypeArrayDynamic ty ->
    let
      rb = ByteString.drop 32 b
      valArray = splitBytes rb ty
    in ValueArrayDynamic <$> sequence valArray
  TypeArrayFixed len ty ->
    let valArray = splitBytes b ty
    in ValueArrayFixed len <$> sequence valArray
  TypeMapping{}  -> Nothing -- TODO: Fixme
  TypeFunction{} -> Nothing -- TODO: Fixme
  TypeContract{} -> undefined -- TODO: the one thing thats not Fixme
  TypeEnum{}     -> Nothing -- TODO: Fixme
  TypeStruct{}   -> Nothing  -- TODO: Fixme
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


bytesToBytesTypePair :: ByteString -> [Type] -> Maybe [(ByteString,Type)]
bytesToBytesTypePair totalBytes typesArr = toBytesTypePair totalBytes typesArr
  where
    toBytesTypePair _ [] = Just []
    toBytesTypePair b (_:_) | ByteString.null b = Nothing
    toBytesTypePair b types =
      let
        headType = head types
        tailTypes = tail types
      in case headType of
        TypeMapping{}       -> Nothing
        TypeFunction{}      -> Nothing
        TypeStruct{}        -> Nothing
        TypeEnum{}          -> undefined -- TODO: Need to implement
        TypeContract{}      -> undefined -- TODO: Need to implement
        TypeArrayDynamic ty -> case getTypeByteLength ty of
          Nothing   -> Nothing
          Just size -> do
            let
              (startingByte, restOfBytes) = ByteString.splitAt 32 b
              start = Binary.decode (ByteString.Lazy.fromStrict startingByte)
              (lengthBytes, rb) = ByteString.splitAt 32
                  (ByteString.drop (fromIntegral (start::Int256)) totalBytes)
              len = Binary.decode (ByteString.Lazy.fromStrict lengthBytes)
              lenAsInt = fromIntegral (len::Int256)
              valueBytes = ByteString.take (size * lenAsInt) rb
              arrayBytes = ByteString.append lengthBytes valueBytes
            rest <- toBytesTypePair restOfBytes tailTypes
            return $ (arrayBytes, headType) : rest
        SimpleType TypeBytes -> do
          let
            (startingByte, restOfBytes) = ByteString.splitAt 32 b
            start = Binary.decode (ByteString.Lazy.fromStrict startingByte)
            (lengthBytes, rb) = ByteString.splitAt 32
                (ByteString.drop (fromIntegral (start::Int256)) totalBytes)
            len = Binary.decode (ByteString.Lazy.fromStrict lengthBytes)
            arrayBytes = ByteString.take (fromIntegral (len::Int256)) rb
          rest <- toBytesTypePair restOfBytes tailTypes
          return $ (arrayBytes, headType) : rest
        SimpleType TypeString -> do
          let
            (startingByte, restOfBytes) = ByteString.splitAt 32 b
            start = Binary.decode (ByteString.Lazy.fromStrict startingByte)
            (lengthBytes, rb) =
              ByteString.splitAt
                32
                (ByteString.drop (fromIntegral (start::Int256)) totalBytes)
            len = Binary.decode (ByteString.Lazy.fromStrict lengthBytes)
            arrayBytes = ByteString.take (fromIntegral (len::Int256)) rb
          rest <- toBytesTypePair restOfBytes tailTypes
          return $ (arrayBytes, headType) : rest
        _ -> case getTypeByteLength headType of
            Nothing -> Nothing
            Just size -> do
              let
                (typeBytes, restOfBytes) = ByteString.splitAt size b
              rest <- toBytesTypePair restOfBytes tailTypes
              return $
                (typeBytes,headType) : rest


valueToText :: Value -> Maybe Text
valueToText = \case
  SimpleValue sv -> simpleValueToText sv
  ValueArrayDynamic vals ->
    Text.concat . intersperse ("," ::Text) <$> sequence (valueToText <$> vals)
  ValueArrayFixed _ vals ->
    Text.concat . intersperse ("," ::Text) <$> sequence (valueToText <$> vals)
  ValueContract addr -> Just . Text.pack $ addressString addr
  ValueEnum{}        -> undefined -- TODO
  ValueFunction{}    -> undefined -- TODO
  ValueStruct{}      -> undefined


simpleValueToText :: SimpleValue -> Maybe Text
simpleValueToText sv = Just $ case sv of
  ValueBool tf -> if tf then "true" else "false"
  ValueUInt8 n -> Text.pack $ show n
  ValueUInt16 n -> Text.pack $ show n
  ValueUInt24 n -> Text.pack $ show n
  ValueUInt32 n -> Text.pack $ show n
  ValueUInt40 n -> Text.pack $ show n
  ValueUInt48 n -> Text.pack $ show n
  ValueUInt56 n -> Text.pack $ show n
  ValueUInt64 n -> Text.pack $ show n
  ValueUInt72 n -> Text.pack $ show n
  ValueUInt80 n -> Text.pack $ show n
  ValueUInt88 n -> Text.pack $ show n
  ValueUInt96 n -> Text.pack $ show n
  ValueUInt104 n -> Text.pack $ show n
  ValueUInt112 n -> Text.pack $ show n
  ValueUInt120 n -> Text.pack $ show n
  ValueUInt128 n -> Text.pack $ show n
  ValueUInt136 n -> Text.pack $ show n
  ValueUInt144 n -> Text.pack $ show n
  ValueUInt152 n -> Text.pack $ show n
  ValueUInt160 n -> Text.pack $ show n
  ValueUInt168 n -> Text.pack $ show n
  ValueUInt176 n -> Text.pack $ show n
  ValueUInt184 n -> Text.pack $ show n
  ValueUInt192 n -> Text.pack $ show n
  ValueUInt200 n -> Text.pack $ show n
  ValueUInt208 n -> Text.pack $ show n
  ValueUInt216 n -> Text.pack $ show n
  ValueUInt224 n -> Text.pack $ show n
  ValueUInt232 n -> Text.pack $ show n
  ValueUInt240 n -> Text.pack $ show n
  ValueUInt248 n -> Text.pack $ show n
  ValueUInt256 n -> Text.pack $ show n
  ValueUInt n -> Text.pack $ show n
  ValueInt8 n -> Text.pack $ show n
  ValueInt16 n -> Text.pack $ show n
  ValueInt24 n -> Text.pack $ show n
  ValueInt32 n -> Text.pack $ show n
  ValueInt40 n -> Text.pack $ show n
  ValueInt48 n -> Text.pack $ show n
  ValueInt56 n -> Text.pack $ show n
  ValueInt64 n -> Text.pack $ show n
  ValueInt72 n -> Text.pack $ show n
  ValueInt80 n -> Text.pack $ show n
  ValueInt88 n -> Text.pack $ show n
  ValueInt96 n -> Text.pack $ show n
  ValueInt104 n -> Text.pack $ show n
  ValueInt112 n -> Text.pack $ show n
  ValueInt120 n -> Text.pack $ show n
  ValueInt128 n -> Text.pack $ show n
  ValueInt136 n -> Text.pack $ show n
  ValueInt144 n -> Text.pack $ show n
  ValueInt152 n -> Text.pack $ show n
  ValueInt160 n -> Text.pack $ show n
  ValueInt168 n -> Text.pack $ show n
  ValueInt176 n -> Text.pack $ show n
  ValueInt184 n -> Text.pack $ show n
  ValueInt192 n -> Text.pack $ show n
  ValueInt200 n -> Text.pack $ show n
  ValueInt208 n -> Text.pack $ show n
  ValueInt216 n -> Text.pack $ show n
  ValueInt224 n -> Text.pack $ show n
  ValueInt232 n -> Text.pack $ show n
  ValueInt240 n -> Text.pack $ show n
  ValueInt248 n -> Text.pack $ show n
  ValueInt256 n -> Text.pack $ show n
  ValueInt n -> Text.pack $ show n
  ValueAddress addr -> Text.pack $ addressString addr
  ValueBytes1 b -> Text.pack $ show . Base16.encode $ ByteString.singleton b
  ValueBytes2 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes3 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes4 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes5 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes6 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes7 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes8 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes9 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes10 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes11 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes12 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes13 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes14 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes15 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes16 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes17 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes18 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes19 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes20 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes21 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes22 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes23 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes24 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes25 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes26 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes27 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes28 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes29 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes30 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes31 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes32 b -> Text.pack $ show . Base16.encode $ b
  ValueBytes b -> Text.pack $ show . Base16.encode $ b
  ValueString tx -> tx

textToValue :: Maybe TypeDefs -> Text -> Type -> Either Text Value
textToValue defs str = \case
  SimpleType ty -> SimpleValue <$> textToSimpleValue str ty
  TypeArrayDynamic ty -> ValueArrayDynamic <$>
    traverse (flip (textToValue defs) ty)
      (Text.split (== ',') (Text.dropAround (\ c -> c == '[' || c == ']') str))
  TypeArrayFixed len ty -> ValueArrayFixed len <$>
    traverse (flip (textToValue defs) ty)
      (Text.split (== ',') (Text.dropAround (\ c -> c == '[' || c == ']') str))
  TypeMapping{}  -> Left "textToValue TODO: TypeMapping not yet implemented"
  TypeFunction{} -> Left "textToValue TODO: TypeFunction not yet implemented"
  TypeContract{} -> ValueContract <$> case stringAddress (Text.unpack str) of
    Nothing -> Left $ "textToValue: could not decode as contract address: " <> str
    Just x -> return x
  TypeEnum name -> case defs of
    Nothing -> Left $ "Enum values cannot be parsed without type definitions" -- TODO(dustin): Pass in TypeDefs
    Just tds -> case Map.lookup name (enumDefs tds) of
      Nothing -> Left $ "Missing enum name in type definitions: " <> name
      Just eSet -> case Bimap.lookupR str eSet of
        Nothing -> Left $ "Missing value '" <> str <> "' in enum definition for " <> name
        Just i -> Right $ ValueEnum name str $ fromIntegral i
  TypeStruct{}   -> Left "textToValue TODO: TypeStruct not yet implemented"

textToSimpleValue :: Text -> SimpleType -> Either Text SimpleValue
textToSimpleValue str = \case
  TypeBool -> case Text.toLower str of
    "true"  -> return $ ValueBool True
    "false" -> return $ ValueBool False
    _       -> Left $ "textToSimpleValue: could not decode TypeBool: " <> str
  TypeUInt8 -> ValueUInt8 <$> readNum
  TypeUInt16 -> ValueUInt16 <$> readNum
  TypeUInt24 -> ValueUInt24 <$> readNum
  TypeUInt32 -> ValueUInt32 <$> readNum
  TypeUInt40 -> ValueUInt40 <$> readNum
  TypeUInt48 -> ValueUInt48 <$> readNum
  TypeUInt56 -> ValueUInt56 <$> readNum
  TypeUInt64 -> ValueUInt64 <$> readNum
  TypeUInt72 -> ValueUInt72 <$> readNum
  TypeUInt80 -> ValueUInt80 <$> readNum
  TypeUInt88 -> ValueUInt88 <$> readNum
  TypeUInt96 -> ValueUInt96 <$> readNum
  TypeUInt104 -> ValueUInt104 <$> readNum
  TypeUInt112 -> ValueUInt112 <$> readNum
  TypeUInt120 -> ValueUInt120 <$> readNum
  TypeUInt128 -> ValueUInt128 <$> readNum
  TypeUInt136 -> ValueUInt136 <$> readNum
  TypeUInt144 -> ValueUInt144 <$> readNum
  TypeUInt152 -> ValueUInt152 <$> readNum
  TypeUInt160 -> ValueUInt160 <$> readNum
  TypeUInt168 -> ValueUInt168 <$> readNum
  TypeUInt176 -> ValueUInt176 <$> readNum
  TypeUInt184 -> ValueUInt184 <$> readNum
  TypeUInt192 -> ValueUInt192 <$> readNum
  TypeUInt200 -> ValueUInt200 <$> readNum
  TypeUInt208 -> ValueUInt208 <$> readNum
  TypeUInt216 -> ValueUInt216 <$> readNum
  TypeUInt224 -> ValueUInt224 <$> readNum
  TypeUInt232 -> ValueUInt232 <$> readNum
  TypeUInt240 -> ValueUInt240 <$> readNum
  TypeUInt248 -> ValueUInt248 <$> readNum
  TypeUInt256 -> ValueUInt256 <$> readNum
  TypeUInt -> ValueUInt <$> readNum
  TypeInt8 -> ValueInt8 <$> readNum
  TypeInt16 -> ValueInt16 <$> readNum
  TypeInt24 -> ValueInt24 <$> readNum
  TypeInt32 -> ValueInt32 <$> readNum
  TypeInt40 -> ValueInt40 <$> readNum
  TypeInt48 -> ValueInt48 <$> readNum
  TypeInt56 -> ValueInt56 <$> readNum
  TypeInt64 -> ValueInt64 <$> readNum
  TypeInt72 -> ValueInt72 <$> readNum
  TypeInt80 -> ValueInt80 <$> readNum
  TypeInt88 -> ValueInt88 <$> readNum
  TypeInt96 -> ValueInt96 <$> readNum
  TypeInt104 -> ValueInt104 <$> readNum
  TypeInt112 -> ValueInt112 <$> readNum
  TypeInt120 -> ValueInt120 <$> readNum
  TypeInt128 -> ValueInt128 <$> readNum
  TypeInt136 -> ValueInt136 <$> readNum
  TypeInt144 -> ValueInt144 <$> readNum
  TypeInt152 -> ValueInt152 <$> readNum
  TypeInt160 -> ValueInt160 <$> readNum
  TypeInt168 -> ValueInt168 <$> readNum
  TypeInt176 -> ValueInt176 <$> readNum
  TypeInt184 -> ValueInt184 <$> readNum
  TypeInt192 -> ValueInt192 <$> readNum
  TypeInt200 -> ValueInt200 <$> readNum
  TypeInt208 -> ValueInt208 <$> readNum
  TypeInt216 -> ValueInt216 <$> readNum
  TypeInt224 -> ValueInt224 <$> readNum
  TypeInt232 -> ValueInt232 <$> readNum
  TypeInt240 -> ValueInt240 <$> readNum
  TypeInt248 -> ValueInt248 <$> readNum
  TypeInt256 -> ValueInt256 <$> readNum
  TypeInt -> ValueInt <$> readNum
  TypeAddress -> ValueAddress <$> case stringAddress (Text.unpack str) of
    Nothing -> Left $ "textToSimpleValue: could not decode as address: " <> str
    Just x -> return x
  TypeBytes1 -> ValueBytes1 . ByteString.head <$> readBytes 1
  TypeBytes2 -> ValueBytes <$> readBytes 2
  TypeBytes3 -> ValueBytes3 <$> readBytes 3
  TypeBytes4 -> ValueBytes4 <$> readBytes 4
  TypeBytes5 -> ValueBytes5 <$> readBytes 5
  TypeBytes6 -> ValueBytes6 <$> readBytes 6
  TypeBytes7 -> ValueBytes7 <$> readBytes 7
  TypeBytes8 -> ValueBytes8 <$> readBytes 8
  TypeBytes9 -> ValueBytes9 <$> readBytes 9
  TypeBytes10 -> ValueBytes10 <$> readBytes 10
  TypeBytes11 -> ValueBytes11 <$> readBytes 11
  TypeBytes12 -> ValueBytes12 <$> readBytes 12
  TypeBytes13 -> ValueBytes13 <$> readBytes 13
  TypeBytes14 -> ValueBytes14 <$> readBytes 14
  TypeBytes15 -> ValueBytes15 <$> readBytes 15
  TypeBytes16 -> ValueBytes16 <$> readBytes 16
  TypeBytes17 -> ValueBytes17 <$> readBytes 17
  TypeBytes18 -> ValueBytes18 <$> readBytes 18
  TypeBytes19 -> ValueBytes19 <$> readBytes 19
  TypeBytes20 -> ValueBytes20 <$> readBytes 20
  TypeBytes21 -> ValueBytes21 <$> readBytes 21
  TypeBytes22 -> ValueBytes22 <$> readBytes 22
  TypeBytes23 -> ValueBytes23 <$> readBytes 23
  TypeBytes24 -> ValueBytes24 <$> readBytes 24
  TypeBytes25 -> ValueBytes25 <$> readBytes 25
  TypeBytes26 -> ValueBytes26 <$> readBytes 26
  TypeBytes27 -> ValueBytes27 <$> readBytes 27
  TypeBytes28 -> ValueBytes28 <$> readBytes 28
  TypeBytes29 -> ValueBytes29 <$> readBytes 29
  TypeBytes30 -> ValueBytes30 <$> readBytes 30
  TypeBytes31 -> ValueBytes31 <$> readBytes 31
  TypeBytes32 -> ValueBytes32 <$> readBytes 32
  TypeBytes -> ValueBytes <$> readBytesDyn
  TypeString -> return $ ValueString str
  where
    readNum :: Num x => Either Text x
    readNum = fromInteger <$> case readMaybe (Text.unpack str) of
      Nothing -> Left $ "textToSimpleValue: could not decode as number: " <> str
      Just x -> return x
    readBytes :: Int -> Either Text ByteString
    readBytes n =
      let
        (bytes, leftover) = Base16.decode (Text.encodeUtf8 str)
      in
        if leftover /= ByteString.empty || ByteString.length bytes /= n
          then Left $ "textToSimpleValue: could not decode as statically sized bytes: " <> str <> ", expected a Base16 encoded string of length " <> Text.pack (show $ 2 * n) <> ", which represents a bytestring of length " <> Text.pack (show n)
          else return bytes
    readBytesDyn :: Either Text ByteString
    readBytesDyn =
      let
        (bytes, leftover) = Base16.decode (Text.encodeUtf8 str)
      in
        if leftover /= ByteString.empty
          then Left $ "textToSimpleValue: could not decode as dynamically sized bytes: " <> str
          else return bytes
