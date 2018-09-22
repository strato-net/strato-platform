{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.Value where


import           Control.Monad           (sequence)
import qualified Data.Bimap              as Bimap
import qualified Data.Binary             as Binary
import           Data.Bits               (complement, shiftL, (.|.))
import           Data.ByteString         (ByteString)
import qualified Data.ByteString         as ByteString
import qualified Data.ByteString.Base16  as Base16
import qualified Data.ByteString.Lazy    as ByteString.Lazy
import           Data.List               (intersperse)
import           Data.Maybe              (fromMaybe)
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
  | ValueAddress Address
  | ValueString Text
  | ValueInt { intSigned :: Bool
             , intSize   :: Maybe Integer
             , intVal    :: Integer
             }
  | ValueBytes { bytesSize :: Maybe Integer
               , bytesVal  :: ByteString
               }
    deriving (Show)

bytesToSimpleValue :: ByteString -> SimpleType -> Maybe SimpleValue
bytesToSimpleValue bs = \case
  TypeBool -> if (bytesToNum False (Just 1)) /= 0
                then Just $ ValueBool True
                else Just $ ValueBool False
  TypeAddress -> ValueAddress <$>  stringAddress (Text.unpack . Text.decodeUtf8 $ Base16.encode bs)
  TypeString -> Just $ ValueString (Text.decodeUtf8 bs)
  TypeInt s b -> Just . ValueInt s b $ bytesToNum s b
  TypeBytes b -> Just $ ValueBytes b bs
  where
    bytesToNum :: Bool -> Maybe Integer -> Integer
    bytesToNum signed' bytes' = if ByteString.null bs then 0 else
      let bs' = ByteString.unpack bs
          h = head bs'
          neg = if signed'
                  then h >= 0x80
                  else False
          bys = fromMaybe 32 bytes'
          a = go neg bs' 0
       in (if neg then negate (a + 1) else a) `mod` (2 `shiftL` fromInteger (8 * bys))
    go :: Bool -> [Word8] -> Integer -> Integer
    go _   []     x = x
    go inv (w:ws) x =
      let x' = x `shiftL` 8
          w' = if inv
                 then complement w
                 else w
       in go inv ws (x' .|. toInteger w')

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
                  (ByteString.drop (fromIntegral (start::Word256)) totalBytes)
              len = Binary.decode (ByteString.Lazy.fromStrict lengthBytes)
              lenAsInt = fromIntegral (len::Word256)
              valueBytes = ByteString.take (size * lenAsInt) rb
              arrayBytes = ByteString.append lengthBytes valueBytes
            rest <- toBytesTypePair restOfBytes tailTypes
            return $ (arrayBytes, headType) : rest
        SimpleType (TypeBytes Nothing) -> do
          let
            (startingByte, restOfBytes) = ByteString.splitAt 32 b
            start = Binary.decode (ByteString.Lazy.fromStrict startingByte)
            (lengthBytes, rb) = ByteString.splitAt 32
                (ByteString.drop (fromIntegral (start::Word256)) totalBytes)
            len = Binary.decode (ByteString.Lazy.fromStrict lengthBytes)
            arrayBytes = ByteString.take (fromIntegral (len::Word256)) rb
          rest <- toBytesTypePair restOfBytes tailTypes
          return $ (arrayBytes, headType) : rest
        SimpleType TypeString -> do
          let
            (startingByte, restOfBytes) = ByteString.splitAt 32 b
            start = Binary.decode (ByteString.Lazy.fromStrict startingByte)
            (lengthBytes, rb) =
              ByteString.splitAt
                32
                (ByteString.drop (fromIntegral (start::Word256)) totalBytes)
            len = Binary.decode (ByteString.Lazy.fromStrict lengthBytes)
            arrayBytes = ByteString.take (fromIntegral (len::Word256)) rb
          rest <- toBytesTypePair restOfBytes tailTypes
          return $ (arrayBytes, headType) : rest
        _ -> case getTypeByteLength headType of -- TODO: Figure out wtf
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
  ValueAddress addr -> Text.pack $ addressString addr
  ValueString tx -> tx
  ValueInt _ _ v -> Text.pack $ show v
  ValueBytes _ b -> Text.pack $ show . Base16.encode $ b

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
  TypeAddress -> ValueAddress <$> case stringAddress (Text.unpack str) of
    Nothing -> Left $ "textToSimpleValue: could not decode as address: " <> str
    Just x -> return x
  TypeString -> return $ ValueString str
  TypeInt s b -> ValueInt s b <$> readNum
  TypeBytes (Just n) -> ValueBytes (Just n) <$> readBytes n
  TypeBytes Nothing -> ValueBytes Nothing <$> readBytesDyn
  where
    readNum :: Either Text Integer
    readNum = case readMaybe (Text.unpack str) of
      Nothing -> Left $ "textToSimpleValue: could not decode as number: " <> str
      Just x -> return x
    readBytes :: Integer -> Either Text ByteString
    readBytes n =
      let
        (bytes', leftover) = Base16.decode (Text.encodeUtf8 str)
      in
        if leftover /= ByteString.empty || ByteString.length bytes' /= fromInteger n
          then Left $ "textToSimpleValue: could not decode as statically sized bytes: " <> str <> ", expected a Base16 encoded string of length " <> Text.pack (show $ 2 * n) <> ", which represents a bytestring of length " <> Text.pack (show n)
          else return bytes'
    readBytesDyn :: Either Text ByteString
    readBytesDyn =
      let
        (bytes', leftover) = Base16.decode (Text.encodeUtf8 str)
      in
        if leftover /= ByteString.empty
          then Left $ "textToSimpleValue: could not decode as dynamically sized bytes: " <> str
          else return bytes'
