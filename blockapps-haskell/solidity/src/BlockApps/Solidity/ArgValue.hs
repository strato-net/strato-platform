{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.ArgValue where

import           BlockApps.Ethereum
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.TypeDefs
import           BlockApps.Solidity.Value
import           ClassyPrelude                ((<>))
import           Control.Lens                 ((&), (?~))
import qualified Data.Aeson                   as A
import qualified Data.Bimap                   as Bimap
import           Data.ByteString              (ByteString)
import qualified Data.ByteString              as ByteString
import qualified Data.ByteString.Base16       as Base16
import qualified Data.Map.Strict              as Map
import           Data.Swagger
import           Data.Text                    (Text)
import qualified Data.Text                    as Text
import qualified Data.Text.Encoding           as Text
import qualified Data.Vector                  as V
import           Test.QuickCheck
import           Text.Read                    (readMaybe)

data ArgValue
  = ArgInt Integer
  | ArgBool Bool
  | ArgString Text
  | ArgArray (V.Vector ArgValue)
  deriving (Eq,Show)

instance Arbitrary ArgValue where
  arbitrary = elements [ArgInt 5,ArgBool True,ArgBool False,ArgString "arggg"]

instance A.FromJSON ArgValue where
  parseJSON = \case
    A.Bool x -> return $ ArgBool x
    A.Number x -> return $ ArgInt (round x)
    A.String x -> return $ ArgString x
    A.Array xs -> ArgArray <$> traverse A.parseJSON xs
    A.Null -> fail "parsing JSON for ArgValue: encountered Null"
    A.Object _ -> fail "parsing JSON for ArgValue: encountered Object"

instance A.ToJSON ArgValue where
  toJSON = \case
    ArgInt x -> A.Number (fromIntegral x)
    ArgBool x -> A.Bool x
    ArgString x -> A.String x
    ArgArray xs -> A.Array (fmap A.toJSON xs)

instance ToSchema ArgValue where
  declareNamedSchema = pure . pure $
    NamedSchema (Just "Solidity Argument Value") $ mempty
      & description ?~ "A Solidity argument value"
      & example ?~ A.toJSON (ArgInt 5)

-- TODO: create valueToArgValue
argValueToValue :: Maybe TypeDefs -> Type -> ArgValue -> Either Text Value
argValueToValue defs theType argVal = case theType of
  SimpleType ty -> SimpleValue <$> argValueToSimpleValue ty argVal
  TypeArrayDynamic ty -> case argVal of
    ArgArray xs -> ValueArrayDynamic . tosparse . V.toList <$>
      traverse (argValueToValue defs ty) xs
    o -> Left . Text.pack $ "argValueToValue: Expected TypeArrayDynamic to be an array, but got: " ++ show o
  TypeArrayFixed len ty -> case argVal of
    ArgArray xs -> if toInteger (V.length xs) == toInteger len
      then ValueArrayFixed len . V.toList <$> traverse (argValueToValue defs ty) xs
      else Left . Text.pack $ "argValueToValue: Expected length of TypeArrayFixed to match length of the array. Expected " ++ show len ++ ", but got " ++ show (length xs)
    o -> Left . Text.pack $ "argValueToValue: Expected TypeArrayFixed to be an array, but got: " ++ show o
  TypeMapping{}  -> Left "argValueToValue TODO: TypeMapping not yet implemented"
  TypeFunction{} -> Left "argValueToValue TODO: TypeFunction not yet implemented"
  TypeContract{} -> case argVal of
    ArgString str -> ValueContract <$> case stringAddress (Text.unpack str) of
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
  TypeStruct{}   -> Left "argValueToValue TODO: TypeStruct not yet implemented"

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
    ArgString str -> ValueAddress <$> case stringAddress (Text.unpack str) of
      Nothing -> Left $ "argValueToSimpleValue: could not decode as address: " <> str
      Just x -> return x
    o -> Left . Text.pack $ "argValueToSimpleValue: Expected TypeAddress to be a string, but got " ++ show o
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
  where
    readBytes :: Integer -> Text -> Either Text ByteString
    readBytes n str =
      let
        (bytes', leftover) = Base16.decode (Text.encodeUtf8 str)
      in
        if leftover /= ByteString.empty || ByteString.length bytes' /= fromInteger n
          then Left $ "argValueToSimpleValue: could not decode as statically sized bytes: " <> str <> ", expected a Base16 encoded string of length " <> Text.pack (show $ 2 * n) <> ", which represents a bytestring of length " <> Text.pack (show n)
          else return bytes'
    readBytesDyn :: Text -> Either Text ByteString
    readBytesDyn str =
      let
        (bytes', leftover) = Base16.decode (Text.encodeUtf8 str)
      in
        if leftover /= ByteString.empty
          then Left $ "argValueToSimpleValue: could not decode as dynamically sized bytes: " <> str
          else return bytes'
