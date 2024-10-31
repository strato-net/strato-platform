{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}

module BlockApps.SolidityVarReader
  ( contractFunctions,
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
    valueToSolidityValue,
    structSort, -- for testing
  )
where

import BlockApps.Solidity.ArgValue
import BlockApps.Solidity.Contract
import BlockApps.Solidity.SolidityValue
import BlockApps.Solidity.Struct
import BlockApps.Solidity.Type
import BlockApps.Solidity.TypeDefs
import BlockApps.Solidity.Value
import BlockApps.Storage (Cache, Storage)
import qualified BlockApps.Storage as Storage
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.Monad (join)
import Control.Exception
import Control.Monad.Except
import Data.Bifunctor (bimap)
import qualified Data.Bimap as Bimap
import Data.Bits
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.IntMap as I
import Data.List
import qualified Data.Map.Ordered as OMap
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Maybe (fromJust, fromMaybe, mapMaybe)
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Data.Word
import Text.Printf
import Text.Read

data SolidityDecodingException
  = EnumOutOfBounds Text Int
  | MissingTypeStruct Text
  deriving (Show)

instance Exception SolidityDecodingException

lastWord64 :: Word256 -> Word64
lastWord64 x = fromIntegral (x .&. 0xffffffffffffffff)

valueToSolidityValue :: Value -> SolidityValue
valueToSolidityValue = \case
  SimpleValue (ValueBool x) -> SolidityBool x
  SimpleValue (ValueInt _ _ v) -> SolidityValueAsString $ Text.pack $ show v
  SimpleValue (ValueDecimal v) -> SolidityValueAsString $ Text.decodeUtf8 v
  SimpleValue (ValueString s) -> SolidityValueAsString s
  SimpleValue (ValueAddress (Address addr)) ->
    SolidityValueAsString $ Text.pack $ printf "%040x" (fromIntegral addr :: Integer)
  SimpleValue (ValueAccount acct) ->
    SolidityValueAsString $ Text.pack $ show acct
  ValueContract acct ->
    SolidityValueAsString $ Text.pack $ show acct
  ValueArrayFixed _ values -> SolidityArray $ map valueToSolidityValue values
  ValueArrayDynamic values -> SolidityArray $ map valueToSolidityValue $ unsparse values
  SimpleValue (ValueBytes _ bytes) ->
    SolidityValueAsString $ Text.pack $ BC.unpack $ B16.encode bytes
  ValueEnum _ _ index -> SolidityValueAsString $ Text.pack $ show index
  -- TODO(tim): What if declaration order is needed here?
  ValueStruct namedItems -> SolidityObject . Map.toList $ fmap valueToSolidityValue namedItems
  ValueMapping m -> SolidityObject . map (bimap simpleValueToText valueToSolidityValue) . Map.toList $ m
  ValueFunction _ paramTypes returnTypes ->
    SolidityValueAsString $
      Text.pack $
        "function ("
          ++ intercalate "," (map (formatType . snd) paramTypes)
          ++ ") returns ("
          ++ intercalate "," (map (formatType . snd) returnTypes)
          ++ ")"
  ValueArraySentinel {} -> error "TODO(tim): ValueArraySentinel"
  ValueVariadic values -> SolidityArray $ map valueToSolidityValue values

word256ToByteString :: Word256 -> ByteString
word256ToByteString = word256ToBytes

byteStringToWord256 :: ByteString -> Word256
byteStringToWord256 = bytesToWord256

getArrayStartingKey :: Word256 -> Word256
getArrayStartingKey = getArrayStartingKeyBS . word256ToByteString

getArrayStartingKeyBS :: ByteString -> Word256
getArrayStartingKeyBS = keccak256ToWord256 . hash

decodeStorageKeySimple :: SimpleType -> Word256 -> Integer -> Integer -> [(Word256, Word256)]
decodeStorageKeySimple TypeString o ofs cnt =
  let sk = toInteger $ getArrayStartingKey o
      ofs' = fromInteger $ sk + (ofs `quot` 32) -- Since each element is one byte
      cnt' = fromInteger $ (ofs + cnt - 1) `quot` 32
   in [(o, 1), (ofs', cnt')]
decodeStorageKeySimple (TypeBytes Nothing) o ofs cnt = decodeStorageKeySimple TypeString o ofs cnt
decodeStorageKeySimple _ o _ _ = [(o, 1)] -- All other simple types fit into one storage cell

decodeStorageKey ::
  TypeDefs ->
  Struct ->
  [Text] ->
  Word256 ->
  Integer ->
  Integer ->
  Bool ->
  [(Word256, Word256)]
decodeStorageKey _ _ [] _ _ _ _ = []
decodeStorageKey typeDefs'@TypeDefs {..} struct' (varName : _) _ ofs cnt len =
  case OMap.lookup varName (fields struct') of
    Nothing -> []
    Just (Left _, _) -> []
    Just (Right Storage.Position {..}, theType) ->
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
               in [(offset, 1), (ofs', cnt')]
        TypeArrayFixed n ty -> do
          if len
            then []
            else
              let (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
                  n' = fromInteger $ toInteger elementSize * toInteger n
               in [(offset, n')]
        -- TODO: The only way to get the offset of a mapping is by supplying the key
        TypeMapping _ _ -> error "decodeStorageKey: TypeMapping"
        TypeFunction name _ _ ->
          error $
            "Cannot retrieve "
              ++ show (ByteString.unpack name)
              ++ ": Functions are not kept in storage"
        TypeStruct name ->
          case Map.lookup name structDefs of
            Nothing -> throw $ MissingTypeStruct name
            Just theStruct -> [(offset, size theStruct)] -- TODO: support struct field accessors, e.g. vehicle.vin
            -- case vs of
            -- [] -> [(offset, size theStruct)]
            -- vs' -> decodeStorageKey typeDefs' struct' vs' (offset + offset') mOffset mCount len
        TypeEnum _ -> [(offset, 1)]
        TypeContract _ -> [(offset, 1)]
        TypeVariadic -> error "decodeStorageKey: TypeVariadic"

decodeCacheValues ::
  Contract ->
  Cache ->
  [(Text, Value)] ->
  [(Text, Value)]
decodeCacheValues (Contract struct' typeDefs') cache state = decodeCacheValues' typeDefs' struct' cache 0 state

decodeCacheValues' :: TypeDefs -> Struct -> Cache -> Word256 -> [(Text, Value)] -> [(Text, Value)]
decodeCacheValues' typeDefs' struct' cache offset state =
  zipWith fromMaybe state $ map (decodeCacheValue typeDefs' struct' cache offset) state

decodeCacheValue ::
  TypeDefs ->
  Struct ->
  Cache ->
  Word256 ->
  (Text, Value) ->
  Maybe (Text, Value)
decodeCacheValue typeDefs' Struct {..} cache offset (name, value) = case OMap.lookup name fields of
  Nothing -> Nothing
  Just (Right position, theType) -> fmap (name,) $ decodeCacheValue' typeDefs' cache (position `Storage.addOffset` fromIntegral offset) value theType
  Just (Left text, theType) -> case (textToValue (Just typeDefs') text theType) of
    Left err -> error $ "decodeCacheValue: textToValue failed to parse with: " ++ show err -- Solidity is a "strongly typed" "language"
    Right val -> Just (name, val)

decodeCacheValue' ::
  TypeDefs ->
  Cache ->
  Storage.Position ->
  Value ->
  Type ->
  Maybe Value
decodeCacheValue' typeDefs'@TypeDefs {..} cache position@Storage.Position {..} value = \case
  SimpleType TypeBool ->
    let v = decodeCacheValue' typeDefs' cache position value $ SimpleType $ TypeInt False (Just 1)
     in case v of
          Just (SimpleValue (ValueInt _ (Just 1) word8)) -> Just $ SimpleValue $ ValueBool $ word8 /= 0
          Just (b@(SimpleValue (ValueBool _))) -> Just b
          o -> error $ "decodeCacheValue': Expected ValueInt or ValueBool, but got: " ++ show o
  SimpleType t@(TypeInt _ mb) ->
    let b = fromInteger $ fromMaybe 32 mb
        b' = if byte + b > 32 then 0 else 32 - byte - b
     in Just . fromMaybe value $
          SimpleValue
            . fromJust
            . flip bytesToSimpleValue t
            . ByteString.take b
            . ByteString.drop b'
            . word256ToByteString
            <$> cache offset
  SimpleType TypeAddress ->
    let v = decodeCacheValue' typeDefs' cache position value $ SimpleType $ TypeInt False (Just 20)
     in case v of
          Just (SimpleValue (ValueInt _ _ addr)) -> Just . SimpleValue . ValueAddress . Address $ fromIntegral addr
          Just (a@(SimpleValue (ValueAddress _))) -> Just a
          o -> error $ "decodeCacheValue': Expected ValueInt or ValueAddress, but got: " ++ show o
  SimpleType TypeAccount ->
    let v = decodeCacheValue' typeDefs' cache position value $ SimpleType $ TypeInt False (Just 20)
     in case v of
          Just (SimpleValue (ValueInt _ _ addr)) -> Just . SimpleValue . ValueAccount . unspecifiedChain $ fromIntegral addr
          Just (a@(SimpleValue (ValueAccount _))) -> Just a
          o -> error $ "decodeCacheValue': Expected ValueInt or ValueAccount, but got: " ++ show o
  TypeContract _ ->
    let v = decodeCacheValue' typeDefs' cache position value $ SimpleType $ TypeInt False (Just 20)
     in case v of
          Just (SimpleValue (ValueInt _ _ addr)) -> Just . ValueContract . unspecifiedChain $ fromIntegral addr
          Just (c@(ValueContract _)) -> Just c
          o -> error $ "decodeCacheValue': Expected ValueInt or ValueContract, but got: " ++ show o
  SimpleType (TypeBytes (Just n)) -> Just $ decodeCacheByteString cache offset byte (fromInteger n) value
  SimpleType (TypeBytes Nothing) -> Just . fromMaybe value . flip fmap (cache offset) $ \w ->
    if w `testBit` 0
      then --large string, 32+ bytes

        let len' = lastWord64 w `div` 2
            startingKey = getArrayStartingKey offset
         in SimpleValue $ valueBytes $ ByteString.pack $ take (fromIntegral len') $ concatMap (ByteString.unpack . word256ToByteString . fromMaybe 0 . cache . (startingKey +)) [0 ..] -- if the length is there, so should the data
      else --small string, less than 32 bytes

        let len' = lastWord64 w .&. 0xfe `div` 2
         in SimpleValue $ valueBytes $ ByteString.take (fromIntegral len') $ word256ToByteString w
  SimpleType TypeString ->
    let v = decodeCacheValue' typeDefs' cache position value $ SimpleType typeBytes
     in case v of
          Just (SimpleValue (ValueBytes Nothing bytes)) -> Just . SimpleValue . ValueString $ Text.decodeUtf8 bytes
          Just (s@(SimpleValue (ValueString _))) -> Just s
          o -> error $ "decodeCacheValue': Expected ValueBytes or ValueString, but got: " ++ show o
  SimpleType TypeDecimal -> Nothing
  TypeFunction selector args returns -> Just $ ValueFunction selector args returns
  TypeArrayFixed _ _ -> Nothing
  {-
    TypeArrayFixed size ty ->
      case value of
        ValueArrayFixed sz vals | sz == size -> ValueArrayFixed size theList
          where
            (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
            theList = zipWith (\ofs val -> decodeCacheValue' typeDefs' cache ((arrayPosition (toInteger elementSize) ofs) `Storage.addOffset` offset) val ty) [0..] vals
        v -> error $ "decodeCacheValue': Expected ValueArrayFixed of size " ++ show size ++ ", but got: " ++ show v
  -}

  TypeArrayDynamic _ -> Nothing
  {-
    TypeArrayDynamic ty ->
      case value of
        ValueArrayDynamic vals -> ValueArrayDynamic theList
          where
            vlen = length vals
            len = fromMaybe vlen $ fromIntegral <$> cache offset
            doesntMatter = decodeValue' typeDefs' (const 0) 0 0 False (Storage.Position 0 0) ty
            -- The value backs provide a default value for every key, so that `mapWithKey` will be called
            -- for each offset.
            valueBacks = I.fromList [(k, doesntMatter) | k <- [0..len -1]]
            vals' = I.filterWithKey (\k _ -> k < len) vals `I.union` valueBacks
            (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
            startingKey = getArrayStartingKey offset
            toPosition ofs' = arrayPosition (toInteger elementSize) (fromIntegral ofs') `Storage.addOffset` startingKey
            theList = I.mapWithKey (\ofs val -> decodeCacheValue' typeDefs' cache (toPosition ofs) val ty) vals'
        v -> error $ "decodeCacheValue': Expected ValueArrayDynamic, but got: " ++ show v
  -}

  TypeMapping _ _ -> Nothing
  --  TypeMapping tyk tyv -> Just $ SimpleValue $ ValueString $ Text.pack $ "mapping (" ++ formatSimpleType tyk ++ " => " ++ formatType tyv ++ ")"

  TypeEnum name ->
    case Map.lookup name enumDefs of
      Nothing -> error $ "Solidity contract is using a missing enum: " ++ show name
      Just enumset -> case value of
        ValueEnum _ _ v ->
          let len' = Bimap.size enumset `shiftR` 8 + 1
              val = fromMaybe v . fmap ((.&. ((1 `shiftL` 8 * (fromIntegral len')) - 1)) . (`shiftR` (byte * 8))) $ cache offset
              ival = fromIntegral val
           in case Bimap.lookup ival enumset of
                Nothing -> throw $ EnumOutOfBounds name ival
                Just x -> Just $ ValueEnum name x val
        v -> error $ "decodeCacheValue': Expected ValueEnum, but got: " ++ show v
  TypeStruct name ->
    case Map.lookup name structDefs of
      Nothing -> throw $ MissingTypeStruct name
      Just theStruct -> case value of
        ValueStruct kvs ->
          let raw_kvs = structSort theStruct $ Map.toList kvs
           in Just . ValueStruct . Map.fromList $ decodeCacheValues' typeDefs' theStruct cache (Storage.alignedByte position) raw_kvs
        v -> error $ "decodeCacheValue': Expected ValueStruct, but got: " ++ show v
  TypeVariadic -> Nothing

structSort :: Struct -> [(Text, Value)] -> [(Text, Value)]
structSort (Struct om _) = sortBy omOrder
  where
    -- Struct sort should run in O(n * log n * log n) as each comparison takes log n
    omOrder :: (Text, Value) -> (Text, Value) -> Ordering
    omOrder (k1, _) (k2, _) = OMap.findIndex k1 om `compare` OMap.findIndex k2 om

contractFunctions ::
  Struct ->
  [(Text, SolidityValue)]
contractFunctions = mapMaybe (uncurry getFunction) . map (fmap snd) . OMap.assocs . fields
  where
    getFunction name = \case
      TypeFunction sel args ret -> Just . (name,) . valueToSolidityValue $ ValueFunction sel args ret
      _ -> Nothing

decodeValues ::
  Integer ->
  TypeDefs ->
  Struct ->
  Storage ->
  Word256 ->
  [(Text, Value)]
decodeValues fetchLimit typeDefs' struct'@Struct {..} storage offset =
  decodeValuesFromList typeDefs' struct' storage offset 0 fetchLimit False (map fst $ OMap.assocs fields)

decodeValuesFromList ::
  TypeDefs ->
  Struct ->
  Storage ->
  Word256 ->
  Integer ->
  Integer ->
  Bool ->
  [Text] ->
  [(Text, Value)]
decodeValuesFromList typeDefs' struct' storage offset ofs cnt len varNames =
  flip zipMaybe varNames (decodeValue typeDefs' storage offset struct' ofs cnt len)
  where
    zipMaybe :: (a -> Maybe b) -> [a] -> [(a, b)]
    zipMaybe _ [] = []
    zipMaybe f (a : as) = case (f a) of
      Nothing -> zipMaybe f as
      Just b -> (a, b) : (zipMaybe f as)

decodeValue ::
  TypeDefs ->
  Storage ->
  Word256 ->
  Struct ->
  Integer ->
  Integer ->
  Bool ->
  Text ->
  Maybe Value
decodeValue typeDefs' storage offset Struct {..} ofs cnt len varName = case OMap.lookup varName fields of
  Nothing -> Nothing
  Just (Right position, theType) ->
    decodeValue' typeDefs' storage ofs cnt len (position `Storage.addOffset` fromIntegral offset) theType
  Just (Left text, theType) -> case (textToValue (Just typeDefs') text theType) of
    Left err -> error $ "decodeValue: textToValue failed to parse with: " ++ show err -- Solidity is a "strongly typed" "language"
    Right val -> Just val

decodeValue' ::
  TypeDefs ->
  Storage ->
  Integer ->
  Integer ->
  Bool ->
  Storage.Position ->
  Type ->
  Maybe Value
decodeValue' typeDefs'@TypeDefs {..} storage ofs cnt len position@Storage.Position {..} = \case
  SimpleType TypeBool ->
    let word8 = case decodeValue' typeDefs' storage ofs cnt len position $ SimpleType $ TypeInt False (Just 1) of
          Just (SimpleValue (ValueInt _ (Just 1) word8')) -> word8'
          _ -> error "decodeValue': Expected ValueInt 1" -- ++ show v
     in Just $ SimpleValue $ ValueBool $ word8 /= 0
  SimpleType t@(TypeInt _ mb) ->
    let b = fromInteger $ fromMaybe 32 mb
        b' = if byte + b > 32 then 0 else 32 - byte - b
     in Just
          . SimpleValue
          . fromJust
          . flip bytesToSimpleValue t
          . ByteString.take b
          . ByteString.drop b'
          . word256ToByteString
          $ storage offset
  SimpleType TypeAddress ->
    let addr = case decodeValue' typeDefs' storage ofs cnt len position $ SimpleType $ TypeInt False (Just 20) of
          Just (SimpleValue (ValueInt _ _ addr')) -> addr'
          _ -> error "decodeValue': Expected ValueInt 2" -- ++ show v
     in Just . SimpleValue . ValueAddress . Address $ fromIntegral addr
  SimpleType TypeAccount ->
    let addr = case decodeValue' typeDefs' storage ofs cnt len position $ SimpleType $ TypeInt False (Just 20) of
          Just (SimpleValue (ValueInt _ _ addr')) -> addr'
          _ -> error "decodeValue': Expected ValueInt 3" -- ++ show v
     in Just . SimpleValue . ValueAccount . unspecifiedChain $ fromIntegral addr
  TypeContract _ ->
    let addr = case decodeValue' typeDefs' storage ofs cnt len position $ SimpleType TypeAccount of
          Just (SimpleValue (ValueAccount addr')) -> addr'
          _ -> error "decodeValue': Expected ValueAccount" -- ++ show v
     in Just $ ValueContract addr
  SimpleType (TypeBytes (Just n)) -> Just $ decodeByteString storage offset byte $ fromInteger n
  SimpleType (TypeBytes Nothing)
    | storage offset `testBit` 0 -> --large string, 32+ bytes
      let len' = lastWord64 (storage offset) `div` 2
          startingKey = getArrayStartingKey offset
       in Just $ SimpleValue $ valueBytes $ ByteString.pack $ take (fromIntegral len') $ concatMap (ByteString.unpack . word256ToByteString . storage . (startingKey +)) [0 ..]
  SimpleType (TypeBytes Nothing) ->
    --small string, less than 32 bytes
    let len' = lastWord64 (storage offset) .&. 0xfe `div` 2
     in Just $ SimpleValue $ valueBytes $ ByteString.take (fromIntegral len') $ word256ToByteString $ storage offset
  SimpleType TypeString ->
    let bytes = case decodeValue' typeDefs' storage ofs cnt len position $ SimpleType typeBytes of
          Just (SimpleValue (ValueBytes Nothing bytes')) -> bytes'
          _ -> error "decodeValue': Expected ValueBytes Nothing" -- ++ show v
     in Just $ SimpleValue $ ValueString $ Text.decodeUtf8 bytes
  SimpleType TypeDecimal -> Nothing
  TypeFunction selector args returns -> Just $ ValueFunction selector args returns
  TypeArrayFixed _ _ -> Nothing
  {-
  TypeArrayFixed size ty -> if len
    then SimpleValue $ valueUInt $ fromIntegral size
    else ValueArrayFixed size theList
    where
      (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
      cnt' = min ((toInteger size) - ofs) cnt
      theList = map (flip (decodeValue' typeDefs' storage ofs cnt len) ty . (`Storage.addOffset` offset) . arrayPosition (toInteger elementSize)) [ofs .. (ofs + cnt' - 1)]
  -}

  TypeArrayDynamic _ -> Nothing
  {-
  TypeArrayDynamic ty -> if len
    then SimpleValue $ valueUInt (toInteger $ storage offset)
    else ValueArrayDynamic $ tosparse theList
    where
      (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
      --The double fromIntegral in the definition of theList is terrible but necessary, since the range only works with Int, and we eventually need a range of Word256s
      cnt' = min ((toInteger $ storage offset) - ofs) cnt
      theList = (flip (decodeValue' typeDefs' storage ofs cnt len) ty . (`Storage.addOffset` startingKey) . arrayPosition (toInteger elementSize)) <$> [ofs..(ofs + cnt' - 1)]
      startingKey = getArrayStartingKey offset
  -}

  TypeMapping _ _ -> Nothing
  --TypeMapping tyk tyv -> SimpleValue $ ValueString $ Text.pack $ "mapping (" ++ formatSimpleType tyk ++ " => " ++ formatType tyv ++ ")"

  TypeEnum name ->
    case Map.lookup name enumDefs of
      Nothing -> error $ "Solidity contract is using a missing enum: " ++ show name
      Just enumset ->
        let len' = fromIntegral $ Bimap.size enumset `shiftR` 8 + 1
            val = fromIntegral $ (.&. ((1 `shiftL` 8 * len') - 1)) $ (`shiftR` (byte * 8)) $ storage offset
         in case Bimap.lookup val enumset of
              Nothing -> throw $ EnumOutOfBounds name val
              Just x -> Just $ ValueEnum name x (fromIntegral val)
  TypeStruct name ->
    case Map.lookup name structDefs of
      Nothing -> throw $ MissingTypeStruct name
      Just theStruct -> Just . ValueStruct . Map.fromList $ decodeValues cnt typeDefs' theStruct storage (Storage.alignedByte position)
  TypeVariadic -> Nothing

--  x -> error $ "Missing case in decodeValue': " ++ show x

decodeMapValue ::
  Integer ->
  TypeDefs ->
  Struct ->
  Storage ->
  Text ->
  Text ->
  Either String Value
--decodeMapValue typeDefs' Struct{..} storage mappingName keyName =
--  undefined typeDefs' storage mappingName keyName
decodeMapValue fetchLimit typeDefs' Struct {..} storage mappingName keyName = do
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
      getValPosition :: SimpleType -> Text -> Storage.Position -> Storage.Position
      getValPosition _ _ _ = Storage.positionAt valPositionInt --TODO fill in this dummy stub
      valPosition = getValPosition fromType keyName position

  let val = decodeValue' typeDefs' storage 0 fetchLimit False valPosition toType

  case val of
    Just v -> return v
    Nothing -> Left "Not supported type in call to decodeMapValue"

encodeValues ::
  TypeDefs ->
  Struct ->
  Word256 ->
  [(Text, ArgValue)] ->
  Either Text (Map Word256 Word256)
encodeValues typeDefs' struct' offset vars =
  zipMapMaybe (uncurry $ encodeValue typeDefs' offset struct') vars Map.empty
  where
    zipMapMaybe _ [] m = Right m
    zipMapMaybe f (a : as) m = case (f a) of
      Left t -> Left t
      Right Nothing -> zipMapMaybe f as m
      Right (Just b) -> zipMapMaybe f as $ foldl' (apply (.|.)) m b
    apply f m (a, b) = case Map.lookup a m of
      Nothing -> Map.insert a b m
      Just c -> Map.insert a (f c b) m

encodeValue ::
  TypeDefs ->
  Word256 ->
  Struct ->
  Text ->
  ArgValue ->
  Either Text (Maybe [(Word256, Word256)])
encodeValue typeDefs' offset Struct {..} varName argVal = case OMap.lookup varName fields of
  Nothing -> Right Nothing
  Just (Right position, theType) -> do
    val <- argValueToValue (Just typeDefs') theType argVal
    return . Just $
      encodeValue' typeDefs' (position `Storage.addOffset` fromIntegral offset) theType val
  Just (Left _, _) -> Left "encodeValue: cannot convert constant variable to storage"

encodeValue' ::
  TypeDefs ->
  Storage.Position ->
  Type ->
  Value ->
  [(Word256, Word256)]
encodeValue' typeDefs'@TypeDefs {} position@Storage.Position {..} ty = \case
  SimpleValue (ValueBool v) -> encodeInt offset byte ((if v then 1 else 0) :: Word8)
  SimpleValue (ValueInt _ _ v) -> encodeInt offset byte v
  SimpleValue (ValueDecimal v) -> [(offset, byteStringToWord256 v)]
  SimpleValue (ValueAddress (Address a)) -> encodeValue' typeDefs' position ty . SimpleValue $ ValueInt False (Just 20) $ toInteger a
  SimpleValue (ValueAccount (NamedAccount a _)) -> encodeValue' typeDefs' position ty . SimpleValue $ ValueInt False (Just 20) $ toInteger a
  ValueContract (NamedAccount a _) -> encodeValue' typeDefs' position ty . SimpleValue $ ValueInt False (Just 20) $ toInteger a
  SimpleValue (ValueBytes (Just n) v) -> encodeByteString offset byte (fromInteger n) v
  SimpleValue (ValueBytes Nothing v) -> [(offset, byteStringToWord256 v)]
  SimpleValue (ValueString v) -> encodeValue' typeDefs' position ty . SimpleValue . ValueBytes Nothing $ Text.encodeUtf8 v
  ValueFunction _ _ _ -> error "Cannot convert function to storage"
  ValueArrayFixed _ vs -> case ty of
    TypeArrayFixed _ ty' ->
      let (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty
          f i v = encodeValue' typeDefs' (arrayPosition (toInteger elementSize) i `Storage.addOffset` offset) ty' v
       in join $ zipWith f [0 ..] vs
    _ -> error $ "encodeValue': Expected ValueArrayFixed to have type TypeArrayFixed, but got: " ++ show ty
  ValueArrayDynamic vs -> case ty of
    TypeArrayDynamic ty' ->
      let (_, elementSize) = getPositionAndSize typeDefs' (Storage.positionAt 0) ty'
          startingKey = getArrayStartingKey offset
          f (i, v) = encodeValue' typeDefs' (arrayPosition (toInteger elementSize) (fromIntegral i) `Storage.addOffset` startingKey) ty' v
       in (offset, fromIntegral $ fst (I.findMax vs) + 1) : concatMap f (I.toList vs)
    _ -> error $ "encodeValue': Expected ValueArrayDynamic to have type TypeArrayDynamic, but got: " ++ show ty
  -- ValueMapping _ -> error "Mappings not supported yet" --SimpleValue $ ValueString $ Text.pack $ "mapping (" ++ formatSimpleValue tyk ++ " => " ++ formatValue tyv ++ ")"

  ValueEnum _ _ index -> encodeInt offset byte index
  ValueStruct _ -> error "Structs not supported yet"
  ValueMapping {} -> error "Mappings unsupported in EVM values"
  ValueArraySentinel {} -> error "ArraySentinel unsupported in EVM values"
  ValueVariadic _ -> error "Variadic not supported yet"

orFail :: Maybe a -> String -> Either String a
orFail Nothing msg = Left msg
orFail (Just x) _ = Right x

encodeByteString :: Word256 -> Int -> Int -> ByteString -> [(Word256, Word256)]
encodeByteString offset byte size bs =
  let bss = ByteString.concat [ByteString.replicate (32 - byte - size) 0, bs, ByteString.replicate byte 0]
   in [(offset, byteStringToWord256 bss)]

decodeByteString :: Storage -> Word256 -> Int -> Int -> Value
decodeByteString storage offset byte size = SimpleValue $ ValueBytes Nothing $ ByteString.take size $ ByteString.drop (32 - byte - size) $ word256ToByteString $ storage offset

decodeCacheByteString :: Cache -> Word256 -> Int -> Int -> Value -> Value
decodeCacheByteString storage offset byte size value = fromMaybe value $ SimpleValue . ValueBytes Nothing . B16.encode . ByteString.take size . ByteString.drop (32 - byte - size) . word256ToByteString <$> storage offset

encodeInt :: (Integral t, Bits t) => Word256 -> Int -> t -> [(Word256, Word256)]
encodeInt offset byte val = return $ fmap (fromIntegral . (`shiftL` (byte * 8))) (offset, val)

arrayPosition :: Integer -> Integer -> Storage.Position
arrayPosition elementSize x
  | elementSize <= 32 =
    let itemsPerWord = 32 `quot` elementSize
        (o, b) = x `quotRem` itemsPerWord
     in Storage.Position {offset = fromInteger $ o, byte = fromInteger $ elementSize * b}
arrayPosition elementSize x =
  let wordsPerItem = elementSize `quot` 32
      o = fromInteger $ x * wordsPerItem
   in Storage.Position {offset = o, byte = 0}
