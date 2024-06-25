{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.ArgValue where

import BlockApps.Solidity.Type
import BlockApps.Solidity.TypeDefs
import BlockApps.Solidity.Value
-- import qualified Data.HashMap.Strict          as HM

import Blockchain.Strato.Model.Address
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
import Data.Decimal
import Data.Either
import qualified Data.Map.Strict as Map
import Data.Scientific
import Data.Swagger
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
          & description ?~ "A Solidity argument value"
          & example ?~ A.toJSON (ArgInt 5)

--Used to coerce the solidity type from the argument values, without having the actual contract type info
argValueToType :: ArgValue -> Type
argValueToType (ArgInt _) = SimpleType typeInt
argValueToType (ArgBool _) = SimpleType TypeBool
argValueToType (ArgString _) = SimpleType TypeString
argValueToType (ArgDecimal _) = SimpleType TypeDecimal
argValueToType (ArgArray v) = TypeArrayDynamic $ argValueToType $ V.head v
argValueToType (ArgObject _) = TypeStruct ""

isSimple :: Type -> Bool
isSimple (SimpleType _) = True
isSimple _ = False

-- TODO: create valueToArgValue
argValueToValue :: Maybe TypeDefs -> Type -> ArgValue -> Either Text Value
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
                let inferredType = argValueToType v
                    value = argValueToValue defs inferredType v
                return value
            )
            hm
        let initialValueType = argValueToType $ snd . head $ KM.toList hm
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
    Nothing -> Left $ "argValueToValue: Enum values cannot be parsed without type definitions" -- TODO(dustin): Pass in TypeDefs
    Just tds -> case Map.lookup enumName (enumDefs tds) of
      Nothing -> Left $ "argValueToValue: Missing enum name in type definitions: " <> enumName
      Just eSet -> case argVal of
        ArgString str ->
          let str' = last $ Text.split (== '.') str
           in case Bimap.lookupR str' eSet of
                Nothing -> Left $ "argValueToValue: Missing value '" <> str <> "' in enum definition for " <> enumName
                Just i -> Right $ ValueEnum enumName str' $ fromIntegral i
        o -> Left . Text.pack $ "argValueToValue: Expected TypeEnum to be a string, but got: " ++ show o
  TypeStruct _ -> do
    case argVal of
      ArgObject hm -> do
        mp <-
          mapM
            ( \v -> do
                let inferredType = argValueToType v
                    value = argValueToValue defs inferredType v
                return value
            )
            hm
        when (any isLeft mp) $ do
          Left "argValueToValue: Could not parse object into a Struct"
        Right $ ValueStruct $ Map.fromList $ [(k, v) | (k, Right v) <- BF.first DAK.toText <$> KM.toList mp]
      a -> Left $ Text.pack $ "argValueToValue: Expected TypeStruct to be a object, but got a" ++ show a
  TypeVariadic -> do
    case argVal of
      ArgArray xs -> do
        listOfVals <-
          mapM
            ( \v -> do
                let inferredType = argValueToType v
                    value = argValueToValue defs inferredType v
                case value of
                  Right v' -> return v'
                  _ -> Left $ "argValueToValue: Could not parse array into a Variadic"
            )
            $ V.toList xs
        Right $ ValueVariadic listOfVals
      o -> Left . Text.pack $ "argValueToValue: Expected TypeVariadic to be an array, but got: " ++ show o

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
        Nothing -> Left $ "argValueToSimpleValue: could not decode as address: " <> str
        Just x -> return x
    o -> Left . Text.pack $ "argValueToSimpleValue: Expected TypeAddress to be a string, but got " ++ show o
  TypeAccount -> case argVal of
    ArgString str ->
      ValueAccount <$> case readMaybe (Text.unpack str) of
        Nothing -> Left $ "argValueToSimpleValue: could not decode as account: " <> str
        Just x -> return x
    o -> Left . Text.pack $ "argValueToSimpleValue: Expected TypeAccount to be a string, but got " ++ show o
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
