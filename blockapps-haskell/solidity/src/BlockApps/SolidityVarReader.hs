{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}

module BlockApps.SolidityVarReader (
  decodeStorageKey,
  decodeCacheValues,
  decodeValue,
  decodeValues,
  decodeValuesFromList,
  decodeMapValue,
  encodeValues,
  encodeValue,
  word256ToByteString,
  byteStringToWord256,
  valueToSolidityValue
  ) where

import           Control.Monad.Except
import qualified Data.Bimap                       as Bimap
import           Data.Binary.Get                  (runGet, getWord64be)
import           Data.Bits
import qualified Data.ByteArray                   as ByteArray
import           Data.ByteString                  (ByteString)
import qualified Data.ByteString                  as ByteString
import qualified Data.ByteString.Base16           as B16
import qualified Data.ByteString.Builder          as BB
import qualified Data.ByteString.Char8            as BC
import qualified Data.ByteString.Lazy             as BL
import           Data.LargeWord
import           Data.List
import           Data.Map.Strict                  (Map)
import qualified Data.Map.Strict                  as Map
import qualified Data.Map.Ordered                 as OMap
import           Data.Maybe                       (fromJust, fromMaybe)
import           Data.Text                        (Text)
import qualified Data.Text                        as Text
import qualified Data.Text.Encoding               as Text
import           Data.Word
import           Text.Printf
import           Text.Read

import           BlockApps.Ethereum
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.TypeDefs
import           BlockApps.Solidity.Value
import           BlockApps.Storage                (Storage, Cache)
import qualified BlockApps.Storage                as Storage

valueToSolidityValue::Value->SolidityValue
valueToSolidityValue (SimpleValue (ValueBool x)) = SolidityBool x
valueToSolidityValue (SimpleValue (ValueInt _ _ v)) = SolidityValueAsString $ Text.pack $ show v
valueToSolidityValue (SimpleValue (ValueString s)) = SolidityValueAsString s
valueToSolidityValue (SimpleValue (ValueAddress (Address addr))) =
  SolidityValueAsString $ Text.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSolidityValue (ValueContract (Address addr)) =
  SolidityValueAsString $ Text.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSolidityValue (ValueArrayFixed _ values) = SolidityArray $ map valueToSolidityValue values
valueToSolidityValue (ValueArrayDynamic values) = SolidityArray $ map valueToSolidityValue values
valueToSolidityValue (SimpleValue (ValueBytes _ bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack $ B16.encode bytes
valueToSolidityValue (ValueEnum _ _ index)              = SolidityValueAsString $ Text.pack $ show index -- SolidityValueAsString $ name `Text.append` "." `Text.append` value
valueToSolidityValue (ValueStruct namedItems) =
  SolidityObject $ map (fmap valueToSolidityValue) namedItems
valueToSolidityValue (ValueFunction _ paramTypes returnTypes) =
  SolidityValueAsString $ Text.pack $ "function ("
                          ++ intercalate "," (map (formatType . snd) paramTypes)
                          ++ ") returns ("
                          ++ intercalate "," (map (formatType . snd) returnTypes)
                          ++ ")"


word256ToByteString::Word256->ByteString
word256ToByteString (LargeKey w1 (LargeKey w2 (LargeKey w3 w4))) =
  ByteString.concat $ map (BL.toStrict . BB.toLazyByteString . BB.word64BE) [w4,w3,w2,w1]

byteStringToWord256 :: ByteString->Word256
byteStringToWord256 bs =
  let
    [w4,w3,w2,w1] = flip runGet (BL.fromStrict bs) $ do
      w_4 <- getWord64be
      w_3 <- getWord64be
      w_2 <- getWord64be
      w_1 <- getWord64be
      return [w_4,w_3,w_2,w_1]
  in LargeKey w1 (LargeKey w2 (LargeKey w3 w4))

getArrayStartingKey :: Word256 -> Word256
getArrayStartingKey = getArrayStartingKeyBS . word256ToByteString

getArrayStartingKeyBS :: ByteString -> Word256
getArrayStartingKeyBS = byteStringToWord256 . ByteArray.convert . digestKeccak256 . keccak256

decodeStorageKeySimple :: SimpleType -> Word256 -> Integer -> Integer -> [(Word256, Word256)]
decodeStorageKeySimple TypeString          o ofs cnt = let sk = toInteger $ getArrayStartingKey o
                                                           ofs' = fromInteger $ sk + (ofs `quot` 32) -- Since each element is one byte
                                                           cnt' = fromInteger $ (ofs + cnt - 1) `quot` 32
                                                        in [(o, 1),(ofs', cnt')]
decodeStorageKeySimple (TypeBytes Nothing) o ofs cnt = decodeStorageKeySimple TypeString o ofs cnt
decodeStorageKeySimple _                   o _   _   = [(o, 1)] -- All other simple types fit into one storage cell

decodeStorageKey
  :: TypeDefs
  -> Struct
  -> [Text]
  -> Word256
  -> Integer
  -> Integer
  -> Bool
  -> [(Word256, Word256)]
decodeStorageKey _ _ [] _ _ _ _ = []
decodeStorageKey typeDefs'@TypeDefs{..} struct' (varName:_) _ ofs cnt len =
  case OMap.lookup varName (fields struct') of
    Nothing -> []
    Just (Left _, _) -> []
    Just (Right Storage.Position{..}, theType) ->
      case theType of
        SimpleType ty -> decodeStorageKeySimple ty offset ofs cnt
        TypeArrayDynamic ty -> do
          if len
            then [(offset, 1)]
            else
              let startingKey = getArrayStartingKey offset
                  (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
                  ofs' = fromInteger $ ofs + toInteger startingKey
                  cnt' = fromInteger $ cnt * toInteger elementSize
              in [(offset, 1), (ofs',cnt')]
        TypeArrayFixed n ty -> do
          if len
            then []
            else
              let (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
                  n' = fromInteger $ toInteger elementSize * toInteger n
              in [(offset, n')]
        TypeMapping _ _ -> undefined -- TODO: The only way to get the offset of a mapping is by supplying the key
        TypeFunction name _ _ -> error $ "Cannot retrieve "
                                       ++ show (ByteString.unpack name)
                                       ++ ": Functions are not kept in storage"
        TypeStruct name ->
          case Map.lookup name structDefs of
            Nothing -> error ""
            Just theStruct -> [(offset, size theStruct)] -- TODO: support struct field accessors, e.g. vehicle.vin
              -- case vs of
              -- [] -> [(offset, size theStruct)]
              -- vs' -> decodeStorageKey typeDefs' struct' vs' (offset + offset') mOffset mCount len
        TypeEnum _ -> [(offset, 1)]
        TypeContract _ -> [(offset, 1)]

decodeCacheValues
  :: TypeDefs
  -> Struct
  -> Cache
  -> Word256
  -> [(Text, Value)]
  -> [(Text, Value)]
decodeCacheValues typeDefs' struct'@Struct{..} cache offset state =
  zipWith fromMaybe state $ map (decodeCacheValue typeDefs' struct' cache offset) state

decodeCacheValue
  :: TypeDefs
  -> Struct
  -> Cache
  -> Word256
  -> (Text, Value)
  -> Maybe (Text, Value)
decodeCacheValue typeDefs' Struct{..} cache offset (name,value) = case OMap.lookup name fields of
   Nothing -> Nothing
   Just (Right position, theType) -> Just (name, decodeCacheValue' typeDefs' cache (position `Storage.addOffset` fromIntegral offset) value theType)
   Just (Left text, theType) -> case (textToValue (Just typeDefs') text theType) of
      Left err -> error $ "decodeCacheValue: textToValue failed to parse with: " ++ show err -- Solidity is a "strongly typed" "language"
      Right val -> Just (name,val)

decodeCacheValue'
  :: TypeDefs
  -> Cache
  -> Storage.Position
  -> Value
  -> Type
  -> Value
decodeCacheValue' typeDefs'@TypeDefs{..} cache position@Storage.Position{..} value = \case
  SimpleType TypeBool ->
    let
      v = decodeCacheValue' typeDefs' cache position value $ SimpleType $ TypeInt False (Just 1)
     in case v of
      SimpleValue (ValueInt _ (Just 1) word8) -> SimpleValue $ ValueBool $ word8 /= 0
      b@(SimpleValue (ValueBool _)) -> b
      o -> error $ "decodeCacheValue': Expected ValueInt or ValueBool, but got: " ++ show o
  SimpleType t@(TypeInt _ mb) -> let b = fromInteger $ fromMaybe 32 mb
                                     b' = if byte + b > 32 then 0 else 32 - byte - b
                                  in fromMaybe value
                                     $ SimpleValue
                                     . fromJust
                                     . flip bytesToSimpleValue t
                                     . ByteString.take b
                                     . ByteString.drop b'
                                     . word256ToByteString
                                   <$> cache offset
  SimpleType TypeAddress ->
    let
      v = decodeCacheValue' typeDefs' cache position value $ SimpleType $ TypeInt False (Just 20)
     in case v of
      SimpleValue (ValueInt _ _ addr) -> SimpleValue . ValueAddress . Address $ fromIntegral addr
      a@(SimpleValue (ValueAddress _)) -> a
      o -> error $ "decodeCacheValue': Expected ValueInt or ValueAddress, but got: " ++ show o
  TypeContract _ ->
    let
      v = decodeCacheValue' typeDefs' cache position value $ SimpleType $ TypeInt False (Just 20)
     in case v of
      SimpleValue (ValueInt _ _ addr) -> ValueContract . Address $ fromIntegral addr
      c@(ValueContract _) -> c
      o -> error $ "decodeCacheValue': Expected ValueInt or ValueContract, but got: " ++ show o
  SimpleType (TypeBytes (Just n)) -> decodeCacheByteString cache offset byte (fromInteger n) value
  SimpleType (TypeBytes Nothing) -> fromMaybe value . flip fmap (cache offset) $ \w ->
    if w `testBit` 0
      then --large string, 32+ bytes
        let
          len' = lastWord64 w `div` 2
          lastWord64::Word256->Word64
          lastWord64 (LargeKey x _) = x
          startingKey = getArrayStartingKey offset
        in SimpleValue $ valueBytes $ ByteString.pack $ take (fromIntegral len') $ concatMap (ByteString.unpack . word256ToByteString . fromMaybe 0 . cache . (startingKey+)) [0..] -- if the length is there, so should the data
      else --small string, less than 32 bytes
        let
          len' = lastWord64 w .&. 0xfe `div` 2
          lastWord64::Word256->Word64
          lastWord64 (LargeKey x _) = x
        in
          SimpleValue $ valueBytes $ ByteString.take (fromIntegral len') $ word256ToByteString w

  SimpleType TypeString ->
    let
      v = decodeCacheValue' typeDefs' cache position value $ SimpleType typeBytes
     in case v of
      SimpleValue (ValueBytes Nothing bytes) -> SimpleValue . ValueString $ Text.decodeUtf8 bytes
      s@(SimpleValue (ValueString _)) -> s
      o -> error $ "decodeCacheValue': Expected ValueBytes or ValueString, but got: " ++ show o

  TypeFunction selector args returns -> ValueFunction selector args returns

  TypeArrayFixed size ty ->
    case value of
      ValueArrayFixed sz vals | sz == size -> ValueArrayFixed size theList
        where
          (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
          theList = zipWith (\ofs val -> decodeCacheValue' typeDefs' cache ((arrayPosition (toInteger elementSize) ofs) `Storage.addOffset` offset) val ty) [0..] vals
      v -> error $ "decodeCacheValue': Expected ValueArrayFixed of size " ++ show size ++ ", but got: " ++ show v

  TypeArrayDynamic ty ->
    case value of
      ValueArrayDynamic vals -> ValueArrayDynamic theList
        where
          vlen = length vals
          len = fromMaybe vlen $ fromIntegral <$> cache offset
          vals' = if len < vlen
                    then take len vals
                    else vals ++ replicate (len - vlen) (decodeValue' typeDefs' (const 0) 0 0 False doesntMatter ty)
                      -- Our cache function is (Just 0), so we don't need to pass in the correct offset
                      where doesntMatter = Storage.Position 0 0
          (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
          theList = zipWith (\ofs val -> decodeCacheValue' typeDefs' cache ((arrayPosition (toInteger elementSize) ofs) `Storage.addOffset` startingKey) val ty) [0..] vals'
          startingKey = getArrayStartingKey offset
      v -> error $ "decodeCacheValue': Expected ValueArrayDynamic, but got: " ++ show v

  TypeMapping tyk tyv -> SimpleValue $ ValueString $ Text.pack $ "mapping (" ++ formatSimpleType tyk ++ " => " ++ formatType tyv ++ ")"

  TypeEnum name ->
    case Map.lookup name enumDefs of
      Nothing -> error $ "Solidity contract is using a missing enum: " ++ show name
      Just enumset -> case value of
        ValueEnum _ _ v ->
          let
            len' = Bimap.size enumset `shiftR` 8 + 1
            val = fromMaybe v . fmap ((.&. ((1 `shiftL` 8*(fromIntegral len')) - 1)) . (`shiftR` (byte*8))) $ cache offset
           in
            case Bimap.lookup (fromIntegral val) enumset of
              Nothing -> error "bad enum value"
              Just x  -> ValueEnum name x val
        v -> error $ "decodeCacheValue': Expected ValueEnum, but got: " ++ show v

  TypeStruct name ->
    case Map.lookup name structDefs of
     Nothing -> error ""
     Just theStruct -> case value of
       ValueStruct kvs -> ValueStruct $ decodeCacheValues typeDefs' theStruct cache (Storage.alignedByte position) kvs
       v -> error $ "decodeCacheValue': Expected ValueStruct, but got: " ++ show v

decodeValues
  :: Integer
  -> TypeDefs
  -> Struct
  -> Storage
  -> Word256
  -> [(Text, Value)]
decodeValues fetchLimit typeDefs' struct'@Struct{..} storage offset =
  decodeValuesFromList typeDefs' struct' storage offset 0 fetchLimit False (map fst $ OMap.assocs fields)

decodeValuesFromList
  :: TypeDefs
  -> Struct
  -> Storage
  -> Word256
  -> Integer
  -> Integer
  -> Bool
  -> [Text]
  -> [(Text, Value)]
decodeValuesFromList typeDefs' struct'@Struct{..} storage offset ofs cnt len varNames =
  flip zipMaybe varNames (decodeValue typeDefs' storage offset struct' ofs cnt len)
  where
    zipMaybe :: (a -> Maybe b) -> [a] -> [(a,b)]
    zipMaybe _ [] = []
    zipMaybe f (a:as) = case (f a) of
                          Nothing -> zipMaybe f as
                          Just b -> (a,b) : (zipMaybe f as)

decodeValue
  :: TypeDefs
  -> Storage
  -> Word256
  -> Struct
  -> Integer
  -> Integer
  -> Bool
  -> Text
  -> Maybe Value
decodeValue typeDefs' storage offset Struct{..} ofs cnt len varName = case OMap.lookup varName fields of
   Nothing -> Nothing
   Just (Right position, theType) ->
     Just $ decodeValue' typeDefs' storage ofs cnt len (position `Storage.addOffset` fromIntegral offset) theType
   Just (Left text, theType) -> case (textToValue (Just typeDefs') text theType) of
      Left err -> error $ "decodeValue: textToValue failed to parse with: " ++ show err -- Solidity is a "strongly typed" "language"
      Right val -> Just val


decodeValue'
  :: TypeDefs
  -> Storage
  -> Integer
  -> Integer
  -> Bool
  -> Storage.Position
  -> Type
  -> Value
decodeValue' typeDefs'@TypeDefs{..} storage ofs cnt len position@Storage.Position{..} = \case
  SimpleType TypeBool ->
    let
      SimpleValue (ValueInt _ (Just 1) word8) = decodeValue' typeDefs' storage ofs cnt len position $ SimpleType $ TypeInt False (Just 1)
    in
     SimpleValue $ ValueBool $ word8 /= 0
  SimpleType t@(TypeInt _ mb) -> let b = fromInteger $ fromMaybe 32 mb
                                     b' = if byte + b > 32 then 0 else 32 - byte - b
                                  in SimpleValue
                                     . fromJust
                                     . flip bytesToSimpleValue t
                                     . ByteString.take b
                                     . ByteString.drop b'
                                     . word256ToByteString
                                     $ storage offset
  SimpleType TypeAddress ->
    let
      SimpleValue (ValueInt _ _ addr) = decodeValue' typeDefs' storage ofs cnt len position $ SimpleType $ TypeInt False (Just 20)
    in
      SimpleValue . ValueAddress . Address $ fromIntegral addr
  TypeContract _ ->
    let
      SimpleValue (ValueAddress addr) = decodeValue' typeDefs' storage ofs cnt len position $ SimpleType TypeAddress
    in
      ValueContract addr
  SimpleType (TypeBytes (Just n)) -> decodeByteString storage offset byte $ fromInteger n
  SimpleType (TypeBytes Nothing) | storage offset `testBit` 0 -> --large string, 32+ bytes
    let
      len' = lastWord64 (storage offset) `div` 2
      lastWord64::Word256->Word64
      lastWord64 (LargeKey x _) = x
      startingKey = getArrayStartingKey offset
    in SimpleValue $ valueBytes $ ByteString.pack $ take (fromIntegral len') $ concatMap (ByteString.unpack . word256ToByteString . storage . (startingKey+)) [0..]

  SimpleType (TypeBytes Nothing) -> --small string, less than 32 bytes
    let
      len' = lastWord64 (storage offset) .&. 0xfe `div` 2
      lastWord64::Word256->Word64
      lastWord64 (LargeKey x _) = x
    in
      SimpleValue $ valueBytes $ ByteString.take (fromIntegral len') $ word256ToByteString $ storage offset

  SimpleType TypeString ->
    let
      SimpleValue (ValueBytes Nothing bytes) = decodeValue' typeDefs' storage ofs cnt len position $ SimpleType typeBytes
    in
      SimpleValue $ ValueString $ Text.decodeUtf8 bytes

  TypeFunction selector args returns -> ValueFunction selector args returns

  TypeArrayFixed size ty -> if len
    then SimpleValue $ valueUInt $ fromIntegral size
    else ValueArrayFixed size theList
    where
      (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
      cnt' = min ((toInteger size) - ofs) cnt
      theList = map (flip (decodeValue' typeDefs' storage ofs cnt len) ty . (`Storage.addOffset` offset) . arrayPosition (toInteger elementSize)) [ofs .. (ofs + cnt' - 1)]

  TypeArrayDynamic ty -> if len
    then SimpleValue $ valueUInt (toInteger $ storage offset)
    else ValueArrayDynamic theList
    where
      (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
      --The double fromIntegral in the definition of theList is terrible but necessary, since the range only works with Int, and we eventually need a range of Word256s
      cnt' = min ((toInteger $ storage offset) - ofs) cnt
      theList = (flip (decodeValue' typeDefs' storage ofs cnt len) ty . (`Storage.addOffset` startingKey) . arrayPosition (toInteger elementSize)) <$> [ofs..(ofs + cnt' - 1)]
      startingKey = getArrayStartingKey offset

  TypeMapping tyk tyv -> SimpleValue $ ValueString $ Text.pack $ "mapping (" ++ formatSimpleType tyk ++ " => " ++ formatType tyv ++ ")"

  TypeEnum name ->
    case Map.lookup name enumDefs of
     Nothing -> error $ "Solidity contract is using a missing enum: " ++ show name
     Just enumset ->
       let
         len' = fromIntegral $ Bimap.size enumset `shiftR` 8 + 1
         val = fromIntegral $ (.&. ((1 `shiftL` 8*len') - 1)) $ (`shiftR` (byte*8)) $ storage offset
       in
        case Bimap.lookup val enumset of
         Nothing -> error "bad enum value"
         Just x  -> ValueEnum name x (fromIntegral val)

  TypeStruct name ->
    case Map.lookup name structDefs of
     Nothing -> error ""
     Just theStruct -> ValueStruct $ decodeValues cnt typeDefs' theStruct storage (Storage.alignedByte position)




--  x -> error $ "Missing case in decodeValue': " ++ show x


decodeMapValue
  :: Integer
  -> TypeDefs
  -> Struct
  -> Storage
  -> Text
  -> Text
  -> Either String Value
--decodeMapValue typeDefs' Struct{..} storage mappingName keyName =
--  undefined typeDefs' storage mappingName keyName
decodeMapValue fetchLimit typeDefs' Struct{..} storage mappingName keyName = do
  (eTxtPos, maybeMappingType) <- OMap.lookup mappingName fields `orFail` ("There is no mapping in the contract named '" ++ Text.unpack mappingName ++ "'")

  position <-
    case eTxtPos of
      Right pos -> return pos
      Left txt -> throwError $ Text.unpack mappingName ++ " is a constant with value \"" ++ show txt ++ "\", which is not allowed."

  (fromType, toType) <-
    case maybeMappingType of
     TypeMapping fromType toType -> return (fromType, toType)
     x -> throwError $ Text.unpack mappingName ++ " is not a map, it is of type " ++ show x

  -- 78338746147236970124700731725183845421594913511827187288591969170390706184117:1

  keyByteString <-
    case fromType of
     TypeInt True (Just 32) -> do
       keyAsInteger <- readMaybe (Text.unpack keyName) `orFail` ("Can not parse key as an Integer: " ++ Text.unpack keyName)
       return $ word256ToByteString $ fromInteger keyAsInteger
     x -> throwError $ "Sorry, This route doesn't support maps with keys of type: " ++ show x

  let valPositionInt = getArrayStartingKeyBS $ keyByteString `ByteString.append` word256ToByteString (Storage.offset position)
      getValPosition::SimpleType->Text->Storage.Position->Storage.Position
      getValPosition _ _ _ = Storage.positionAt valPositionInt  --TODO fill in this dummy stub
      valPosition = getValPosition fromType keyName position

  let val = decodeValue' typeDefs' storage 0 fetchLimit False valPosition toType

  return val

encodeValues
  :: TypeDefs
  -> Struct
  -> Word256
  -> [(Text,Text)]
  -> Map Word256 Word256
encodeValues typeDefs' struct'@Struct{..} offset vars =
  zipMapMaybe (uncurry $ encodeValue typeDefs' offset struct') vars Map.empty
  where
    zipMapMaybe _ [] m = m
    zipMapMaybe f (a:as) m = case (f a) of
      Nothing -> zipMapMaybe f as m
      Just b -> zipMapMaybe f as $ foldl' (apply (.|.)) m b
    apply f m (a,b) = case Map.lookup a m of
      Nothing -> Map.insert a b m
      Just c -> Map.insert a (f c b) m

encodeValue
  :: TypeDefs
  -> Word256
  -> Struct
  -> Text
  -> Text
  -> Maybe [(Word256,Word256)]
encodeValue typeDefs' offset Struct{..} varName val = case OMap.lookup varName fields of
   Nothing -> Nothing
   Just (Right position, theType) -> case (textToValue (Just typeDefs') val theType) of
     Left err -> error $ "encodeValue: textToValue failed to parse with: " ++ show err -- Solidity is a "strongly typed" "language"
     Right v -> Just $ encodeValue' typeDefs' (position `Storage.addOffset` fromIntegral offset) v
   Just (Left _, _) -> error "decodeValue: cannot convert constant variable to storage"

encodeValue'
  :: TypeDefs
  -> Storage.Position
  -> Value
  -> [(Word256,Word256)]
encodeValue' typeDefs'@TypeDefs{..} position@Storage.Position{..} = \case
  SimpleValue (ValueBool v) -> encodeInt offset byte ((if v then 1 else 0) :: Word8)
  SimpleValue (ValueInt _ _ v) -> encodeInt offset byte v
  SimpleValue (ValueAddress (Address a)) -> encodeValue' typeDefs' position . SimpleValue $ ValueInt False (Just 20) $ toInteger a
  ValueContract (Address a) -> encodeValue' typeDefs' position . SimpleValue $ ValueInt False (Just 20) $ toInteger a
  SimpleValue (ValueBytes (Just n) v) -> encodeByteString offset byte (fromInteger n) v
  SimpleValue (ValueBytes Nothing v) -> [(offset, byteStringToWord256 v)]

  SimpleValue (ValueString v) -> encodeValue' typeDefs' position . SimpleValue . ValueBytes Nothing $ Text.encodeUtf8 v

  ValueFunction _ _ _ -> error "Cannot convert function to storage"

  ValueArrayFixed _ _ -> error "Arrays not supported yet" --if len
    -- then SimpleValue $ ValueUInt $ fromIntegral size
    -- else ValueArrayFixed size theList
    -- where
    --   (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
    --   ofs' :: Word256 = fromIntegral . toInteger $ maybe 0 id ofs
    --   cnt' :: Word256 = max 0 . min ((fromIntegral size) - ofs') . fromIntegral $ maybe 100 id cnt
    --   theList = map (flip (encodeValue' typeDefs' storage ofs cnt len) ty . (`Storage.addOffset` offset) . arrayPosition elementSize) [ofs' .. (ofs' + cnt' - 1)]

  ValueArrayDynamic _ -> error "Arrays not supported yet" --if len
    -- then SimpleValue $ ValueUInt (storage offset)
    -- else ValueArrayDynamic theList
    -- where
    --   (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
    --   --The double fromIntegral in the definition of theList is terrible but necessary, since the range only works with Int, and we eventually need a range of Word256s
    --   ofs' = maybe 0 id ofs
    --   cnt' = max 0 . min ((fromIntegral $ storage offset) - ofs') $ maybe 100 id cnt
    --   theList = (flip (EncodeValue' typeDefs' storage ofs cnt len) ty . (`Storage.addOffset` startingKey) . arrayPosition elementSize . fromIntegral) <$> [ofs'..(ofs' + cnt' - 1)]
    --   startingKey=byteStringToWord256 $ ByteArray.convert $ digestKeccak256 $ keccak256 $ word256ToByteString offset

  -- ValueMapping _ -> error "Mappings not supported yet" --SimpleValue $ ValueString $ Text.pack $ "mapping (" ++ formatSimpleValue tyk ++ " => " ++ formatValue tyv ++ ")"

  ValueEnum _ _ index -> encodeInt offset byte index

  ValueStruct _ -> error "Structs not supported yet"
    -- case Map.lookup name structDefs of
    --  Nothing -> error ""
    --  Just theStruct -> ValueStruct $ EncodeValues typeDefs' theStruct storage (Storage.alignedByte position)




orFail::Maybe a->String->Either String a
orFail Nothing msg = Left msg
orFail (Just x) _ = Right x


encodeByteString :: Word256 -> Int -> Int -> ByteString -> [(Word256,Word256)]
encodeByteString offset byte size bs =
  let bss = ByteString.concat [ByteString.replicate (32 - byte - size) 0, bs, ByteString.replicate byte 0]
   in [(offset, byteStringToWord256 bss)]

decodeByteString::Storage->Word256->Int->Int->Value
decodeByteString storage offset byte size = SimpleValue $ ValueBytes Nothing $ ByteString.take size $ ByteString.drop (32 - byte - size) $ word256ToByteString $ storage offset

decodeCacheByteString :: Cache -> Word256 -> Int -> Int -> Value -> Value
decodeCacheByteString storage offset byte size value = fromMaybe value $ SimpleValue . ValueBytes Nothing . B16.encode . ByteString.take size . ByteString.drop (32 - byte - size) . word256ToByteString <$> storage offset

encodeInt :: (Num t, Integral t, Bits t) => Word256 -> Int -> t -> [(Word256,Word256)]
encodeInt offset byte val = return $ fmap (fromIntegral . (`shiftL` (byte*8))) (offset,val)

arrayPosition :: Integer -> Integer -> Storage.Position
arrayPosition elementSize x | elementSize <= 32 =
  let
    itemsPerWord = 32 `quot` elementSize
    (o, b) = x `quotRem` itemsPerWord
  in
   Storage.Position{offset=fromInteger $ o, byte = fromInteger $ elementSize * b}

arrayPosition elementSize x =
  let
    wordsPerItem = elementSize `quot` 32
    o = fromInteger $ x * wordsPerItem
  in
    Storage.Position{offset=o, byte=0}
