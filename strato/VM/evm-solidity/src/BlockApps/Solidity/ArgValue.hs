{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}

module BlockApps.Solidity.ArgValue where

import BlockApps.Solidity.Type
import BlockApps.Solidity.TypeDefs
import BlockApps.Solidity.Value
import BlockApps.Solidity.Struct (Struct(..))
import qualified Data.Map.Ordered as OMap

import Blockchain.Strato.Model.Address
import Control.Applicative ((<|>))
import Control.Lens ((&), (?~))
import Control.Monad
import qualified Data.Aeson as A
import qualified Data.Aeson.Key as DAK
import qualified Data.Aeson.KeyMap as KM
import qualified Data.Bifunctor as BF
import qualified Data.Bimap as Bimap
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Base16 as Base16
import qualified Data.ByteString.Lazy as BSL
import Data.Decimal
import Data.Either
import qualified Data.Map.Strict as Map
import Data.Maybe (fromMaybe, isJust)
import Data.OpenApi hiding (value)
import Data.Scientific
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import qualified Data.Vector as V
import Test.QuickCheck
import Text.Read (readMaybe)

data ArgValue
  = ArgInt Integer
  | ArgBool Bool
  | ArgString Text
  | ArgDecimal Decimal
  | ArgArray (V.Vector ArgValue)
  | ArgObject (KM.KeyMap ArgValue)
  deriving (Eq, Show)

instance Arbitrary ArgValue where
  arbitrary = elements [ArgInt 5, ArgBool True, ArgBool False, ArgString "arggg", ArgDecimal 3.3]

instance A.FromJSON ArgValue where
  parseJSON = \case
    A.Bool x -> return $ ArgBool x
    A.Number x -> case isFloating x of
      True -> return $ ArgDecimal (read $ show x :: Decimal)
      False -> return $ ArgInt (round x)
    A.String x -> return $ ArgString x
    A.Array xs -> ArgArray <$> traverse A.parseJSON xs
    A.Null -> fail "parsing JSON for ArgValue: encountered Null"
    A.Object xo -> ArgObject <$> traverse A.parseJSON xo

-- fmap A.parseJSON xo

instance A.ToJSON ArgValue where
  toJSON = \case
    ArgInt x -> A.Number (fromIntegral x)
    ArgBool x -> A.Bool x
    ArgString x -> A.String x
    ArgDecimal (Decimal p m) -> A.Number (scientific m $ fromIntegral p)
    ArgArray xs -> A.Array (fmap A.toJSON xs)
    ArgObject o -> A.Object (fmap A.toJSON o)

instance ToSchema ArgValue where
  declareNamedSchema =
    pure . pure $
      NamedSchema (Just "Solidity Argument Value") $
        mempty
          & description ?~ "A Solidity argument value, optionally wrapped in a type-hint object of the shape {\"type\": \"<solidity type>\", \"value\": <argument>}"
          & example ?~ A.toJSON (ArgInt 5)

-- | Arguments may be wrapped in an object of the shape
-- {"type": "<solidity type name>", "value": <argument>} to make the intended
-- Solidity type explicit when it cannot be inferred from the JSON encoding
-- alone (e.g. an address vs. a numeric string).
splitTypeHint :: ArgValue -> Maybe (Text, ArgValue)
splitTypeHint (ArgObject o)
  | KM.size o == 2,
    Just (ArgString typeName) <- KM.lookup "type" o,
    Just v <- KM.lookup "value" o =
      Just (Text.strip typeName, v)
splitTypeHint _ = Nothing

-- | Parse a builtin Solidity type name like "uint256", "address", "bytes32",
-- or "uint[3][]". Returns Nothing for non-builtin names (structs, enums,
-- contracts), which can only be resolved against the contract's type definitions.
parseSolidityTypeName :: Text -> Maybe Type
parseSolidityTypeName full = do
  let (base, suffixes) = Text.break (== '[') (Text.strip full)
  baseType <- parseBase base
  wrapArrays baseType suffixes
  where
    parseBase :: Text -> Maybe Type
    parseBase t = SimpleType <$> case t of
      "bool" -> Just TypeBool
      "address" -> Just TypeAddress
      "account" -> Just TypeAddress
      "string" -> Just TypeString
      "decimal" -> Just TypeDecimal
      "byte" -> Just $ TypeBytes (Just 1)
      "bytes" -> Just $ TypeBytes Nothing
      "int" -> Just typeInt
      "uint" -> Just typeUInt
      _
        | Just n <- readSuffix "bytes" t, n >= 1 && n <= 32 -> Just $ TypeBytes (Just n)
        | Just n <- readSuffix "uint" t -> TypeInt False <$> intBytes n
        | Just n <- readSuffix "int" t -> TypeInt True <$> intBytes n
        | otherwise -> Nothing
    readSuffix :: Text -> Text -> Maybe Integer
    readSuffix pfx t = Text.stripPrefix pfx t >>= readMaybe . Text.unpack
    -- Sizes are stored in bytes, e.g. "uint256" -> TypeInt False (Just 32)
    intBytes :: Integer -> Maybe (Maybe Integer)
    intBytes bits = do
      guard $ bits `mod` 8 == 0 && bits >= 8 && bits <= 256
      return . Just $ bits `div` 8
    wrapArrays :: Type -> Text -> Maybe Type
    wrapArrays ty sfx
      | Text.null sfx = Just ty
      | otherwise = do
          afterOpen <- Text.stripPrefix "[" sfx
          let (lenText, rest) = Text.break (== ']') afterOpen
          rest' <- Text.stripPrefix "]" rest
          ty' <-
            if Text.null lenText
              then Just $ TypeArrayDynamic ty
              else TypeArrayFixed <$> readMaybe (Text.unpack lenText) <*> pure ty
          wrapArrays ty' rest'

--Used to coerce the solidity type from the argument values, without having the actual contract type info
argValueToType :: ArgValue -> (Type, ArgValue)
argValueToType v'
  | Just (typeName, v) <- splitTypeHint v' = case parseSolidityTypeName typeName of
      Just ty -> (ty, v)
      -- A named (non-builtin) type: infer its flavor from the shape of the value
      Nothing -> case v of
        ArgObject _ -> (TypeStruct typeName, v)
        ArgString s
          | isJust (readMaybe (Text.unpack s) :: Maybe Address) -> (TypeContract typeName, v)
          | otherwise -> (TypeEnum typeName, v)
        ArgInt _ -> (SimpleType typeUInt, v) -- Enums may be passed as ints
        _ -> argValueToType v
argValueToType v@(ArgInt _) = (SimpleType typeInt, v)
argValueToType v@(ArgBool _) = (SimpleType TypeBool, v)
argValueToType v@(ArgString s') = maybe (SimpleType TypeString, v) id $
  castArgType s' <|>
  (let s = Text.unpack s'
   in case s of
        '0':'x':_ -> ((SimpleType TypeAddress, v) <$ ((readMaybe s) :: Maybe Address))
                 <|> ((SimpleType typeInt,) . ArgInt <$> ((readMaybe s) :: Maybe Integer))
        '"':_     -> ((SimpleType TypeString,) . ArgString . Text.pack <$> ((readMaybe s) :: Maybe String))
        -- Try to parse strings that look like JSON arrays
        '[':_     -> (argValueToType <$> A.decode (BSL.fromStrict $ Text.encodeUtf8 s'))
        -- Try to parse strings that look like JSON objects
        '{':_     -> (argValueToType <$> A.decode (BSL.fromStrict $ Text.encodeUtf8 s'))
        _         -> ((SimpleType typeInt,) . ArgInt <$> ((readMaybe s) :: Maybe Integer))
                 <|> ((SimpleType TypeAddress, v) <$ ((readMaybe s) :: Maybe Address)))
argValueToType v@(ArgDecimal _) = (SimpleType TypeDecimal, v)
argValueToType v@(ArgArray vs) = (TypeArrayDynamic $ fst $ argValueToType $ V.head vs, v)
argValueToType v@(ArgObject _) = (TypeStruct "", v)

-- | An explicit cast literal (string("…"), address("hex"), uint(5), …) names
-- its own type, so no shape inference is needed. These appear when
-- already-rendered literals are re-marshaled (wallet-wrapped calls,
-- castVoteOnIssue args); an unparseable inner value falls back to inference.
castArgType :: Text -> Maybe (Type, ArgValue)
castArgType t = do
  (castType, raw) <- splitCastLiteral t
  -- Quoted forms unquote+unescape; bare forms pass through. The string cast
  -- REQUIRES a quoted inner (mirroring the VM's parser), so an ordinary string
  -- value that merely looks like "string(hello)" is never unwrapped.
  let mQuoted = unquoteCastInner raw
      inner = fromMaybe raw mQuoted
      s = Text.unpack inner
  case castType of
    "string" -> (\q -> (SimpleType TypeString, ArgString q)) <$> mQuoted
    "address" -> (SimpleType TypeAddress, ArgString inner) <$ (readMaybe s :: Maybe Address)
    "uint" -> (SimpleType typeUInt,) . ArgInt <$> readMaybe s
    "int" -> (SimpleType typeInt,) . ArgInt <$> readMaybe s
    "bool" -> case Text.toLower inner of
      "true" -> Just (SimpleType TypeBool, ArgBool True)
      "false" -> Just (SimpleType TypeBool, ArgBool False)
      _ -> Nothing
    "decimal" -> (SimpleType TypeDecimal,) . ArgDecimal <$> readMaybe s
    "bytes" -> (SimpleType (TypeBytes Nothing),) . ArgString <$> mQuoted
    _ -> Nothing

isSimple :: Type -> Bool
isSimple (SimpleType _) = True
isSimple _ = False

-- TODO: create valueToArgValue
argValueToValue :: Maybe TypeDefs -> Type -> ArgValue -> Either Text Value
argValueToValue defs theType argVal
  | Just (_, inner) <- splitTypeHint argVal,
    not (structExpectsHintFields theType) =
      -- The declared type is authoritative here, so drop the hint and coerce the wrapped value
      argValueToValue defs theType inner
  where
    -- Don't unwrap when the argument is a struct that genuinely has "type" and "value" fields
    structExpectsHintFields (TypeStruct structName) =
      case defs >>= Map.lookup structName . structDefs of
        Just struct -> isJust (OMap.lookup "type" (fields struct)) && isJust (OMap.lookup "value" (fields struct))
        Nothing -> False
    structExpectsHintFields _ = False
argValueToValue defs theType argVal = case theType of
  SimpleType ty -> SimpleValue <$> argValueToSimpleValue ty argVal
  TypeArrayDynamic ty -> case argVal of
    ArgArray xs ->
      ValueArrayDynamic . tosparse . V.toList
        <$> traverse (argValueToValue defs ty) xs
    o -> Left . Text.pack $ "argValueToValue: Expected TypeArrayDynamic to be an array, but got: " ++ show o
  TypeArrayFixed len ty -> case argVal of
    ArgArray xs ->
      if toInteger (V.length xs) == toInteger len
        then ValueArrayFixed len . V.toList <$> traverse (argValueToValue defs ty) xs
        else Left . Text.pack $ "argValueToValue: Expected length of TypeArrayFixed to match length of the array. Expected " ++ show len ++ ", but got " ++ show (length xs)
    o -> Left . Text.pack $ "argValueToValue: Expected TypeArrayFixed to be an array, but got: " ++ show o
  TypeMapping {} -> do
    case argVal of
      ArgObject hm -> do
        mp <-
          mapM
            ( \v -> do
                let (inferredType, v') = argValueToType v
                    value = argValueToValue defs inferredType v'
                return value
            )
            hm
        let initialValueType = case KM.toList hm of
              [] -> error "initialValueType: Empty list"
              (x:_) -> argValueToType $ snd x
            isUniform = foldl (\b av -> b && argValueToType av == initialValueType) True hm
        when (any isLeft mp) $ do
          Left "argValueToValue: Could not parse object into a Mapping"
        when (not isUniform) $ do
          Left "argValueToValue: Mapping object does not contain uniform values"
        -- Use a struct because it is parsed in the VM as different types once it has the correct type info for args
        Right $ ValueStruct $ Map.fromList $ [(k, v) | (k, Right v) <- BF.first DAK.toText <$> KM.toList mp]
      a -> Left $ Text.pack $ "argValueToValue: Expected TypeMapping to be a object, but got a" ++ show a
  TypeFunction {} -> Left "argValueToValue TODO: TypeFunction not yet implemented"
  TypeContract {} -> case argVal of
    ArgString str ->
      ValueContract <$> case readMaybe (Text.unpack str) of
        Nothing -> Left $ "argValueToValue: could not decode as contract address: " <> str
        Just x -> return x
    o -> Left . Text.pack $ "argValueToValue: Expected TypeContract to be a string, but got: " ++ show o
  TypeEnum enumName -> case defs of
    Nothing -> Left $ "argValueToValue: Enum values cannot be parsed without type definitions"
    Just tds -> case Map.lookup enumName (enumDefs tds) of
      Nothing -> Left $ "argValueToValue: Missing enum name in type definitions: " <> enumName
      Just eSet -> case argVal of
        ArgString str ->
          let str' = last $ Text.split (== '.') str
           in case Bimap.lookupR str' eSet of
                Nothing -> Left $ "argValueToValue: Missing value '" <> str <> "' in enum definition for " <> enumName
                Just i -> Right $ ValueEnum enumName str' $ fromIntegral i
        o -> Left . Text.pack $ "argValueToValue: Expected TypeEnum to be a string, but got: " ++ show o
  TypeStruct structName -> do
    case argVal of
      ArgObject hm -> do
        -- Try to look up struct definition for field types
        let mStructDef = defs >>= Map.lookup structName . structDefs
            getFieldType fieldName v = case mStructDef of
              Just struct -> case OMap.lookup fieldName (fields struct) of
                Just (_, fieldType) -> fieldType
                Nothing -> fst $ argValueToType v
              Nothing -> fst $ argValueToType v
        mp <-
          mapM
            ( \(k, v) -> do
                let fieldName = DAK.toText k
                    fieldType = getFieldType fieldName v
                    value = argValueToValue defs fieldType v
                return (fieldName, value)
            )
            (KM.toList hm)
        case [(k, e) | (k, Left e) <- mp] of
          [] -> Right $ ValueStruct $ Map.fromList $ [(k, v) | (k, Right v) <- mp]
          errors -> Left $ "argValueToValue: Could not parse struct '" <> structName <> "': " <> Text.intercalate "; " [k <> ": " <> e | (k, e) <- errors]
      a -> Left $ Text.pack $ "argValueToValue: Expected TypeStruct to be a object, but got a" ++ show a
  TypeVariadic -> do
    case argVal of
      ArgArray xs -> do
        listOfVals <-
          mapM
            ( \v -> do
                let (inferredType, v') = argValueToType v
                    value = argValueToValue defs inferredType v'
                case value of
                  Right v'' -> return v''
                  _ -> Left $ "argValueToValue: Could not parse array into a Variadic"
            )
            $ V.toList xs
        Right $ ValueVariadic listOfVals
      v -> do
        let (inferredType, v') = argValueToType v
            value = argValueToValue defs inferredType v'
        case value of
          Right v'' -> return v''
          _ -> Left $ "argValueToValue: Could not parse array into a Variadic"

argValueToSimpleValue :: SimpleType -> ArgValue -> Either Text SimpleValue
argValueToSimpleValue theType argVal = case theType of
  TypeBool -> case argVal of
    ArgBool x -> return $ ValueBool x
    ArgString str -> case Text.toLower str of
      "true" -> return $ ValueBool True
      "false" -> return $ ValueBool False
      _ -> Left $ "argValueToSimpleValue: Could not parse boolean value from string \"" <> str <> "\""
    o -> Left . Text.pack $ "argValueToSimpleValue: Expected TypeBool to be a boolean, but got " ++ show o
  TypeAddress -> case argVal of
    ArgString str ->
      ValueAddress <$> case stringAddress (Text.unpack str) of
        Nothing -> Left $ "argValueToSimpleValue: provided argument '" <> str <> "' is not a valid address"
        Just x -> return x
    ArgInt i -> Right . ValueAddress $ fromIntegral i
    o -> Left . Text.pack $ "argValueToSimpleValue: Expected TypeAddress to be a string or an integer, but got " ++ show o
  TypeString -> case argVal of
    ArgString str -> return $ ValueString str
    o -> Left . Text.pack $ "argValueToSimpleValue: Expected TypeString to be a string, but got " ++ show o
  TypeInt s b -> case argVal of
    ArgInt i -> Right $ ValueInt s b i
    ArgString str -> case readMaybe (Text.unpack str) of
      Just i -> Right $ ValueInt s b i
      Nothing -> Left $ "argValueToSimpleValue: Could not parse integer value from string \"" <> str <> "\""
    o -> Left . Text.pack $ "argValueToSimpleValue: Expected TypeInt to be an integer, but got " ++ show o
  TypeBytes (Just n) -> case argVal of
    ArgString str -> ValueBytes (Just n) <$> readBytes n str
    o -> Left . Text.pack $ "argValueToSimpleValue: Expected TypeBytes to be a string, but got " ++ show o
  TypeBytes Nothing -> case argVal of
    ArgString str -> ValueBytes Nothing <$> readBytesDyn str
    o -> Left . Text.pack $ "argValueToSimpleValue: Expected TypeBytes to be a string, but got " ++ show o
  TypeDecimal -> case argVal of
    ArgDecimal i -> Right $ ValueDecimal (Text.encodeUtf8 $ Text.pack $ show i)
    ArgInt i -> Right $ ValueDecimal (Text.encodeUtf8 $ Text.pack $ show i)
    -- Clients send high-precision decimals as strings (a JSON number would be
    -- rounded through a double); parse them exactly.
    ArgString str -> case readMaybe (Text.unpack str) :: Maybe Decimal of
      Just d -> Right $ ValueDecimal (Text.encodeUtf8 $ Text.pack $ show d)
      Nothing -> Left $ "argValueToSimpleValue: Could not parse decimal value from string \"" <> str <> "\""
    o -> Left . Text.pack $ "argValueToSimpleValue: Expected TypeDecimal to be an decimal, but got " ++ show o

  where
    readBytes :: Integer -> Text -> Either Text ByteString
    readBytes n str =
      case Base16.decode (Text.encodeUtf8 str) of
        Right bytes' | ByteString.length bytes' == fromInteger n -> return bytes'
        _ -> Left $ "argValueToSimpleValue: could not decode as statically sized bytes: " <> str <> ", expected a Base16 encoded string of length " <> Text.pack (show $ 2 * n) <> ", which represents a bytestring of length " <> Text.pack (show n)
    readBytesDyn :: Text -> Either Text ByteString
    readBytesDyn str =
      case Base16.decode (Text.encodeUtf8 str) of
        Right bytes' -> return bytes'
        _ -> Left $ "argValueToSimpleValue: could not decode as dynamically sized bytes: " <> str
