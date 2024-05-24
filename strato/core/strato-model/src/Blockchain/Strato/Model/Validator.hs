{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Strato.Model.Validator
  ( ValidatorSet (..),
    Validator (..),
  )
where

import Blockchain.Data.RLP
import Control.DeepSeq
import Control.Lens hiding ((.=))
import Data.Aeson hiding (Array, String)
import qualified Data.Aeson as A (Value (..))
import Data.Aeson.Casing.Internal (camelCase, dropFPrefix)
import Data.Binary
import Data.Data
import Data.Maybe (fromMaybe)
import qualified Data.Set as S
import Data.Swagger hiding (Format, get, name, put, url)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Vector as V
import GHC.Generics
import qualified Generic.Random as GR
import Test.QuickCheck.Arbitrary
import Test.QuickCheck.Arbitrary.Generic
import Test.QuickCheck.Instances.Text ()
import Text.Format
import Text.Printf

newtype ValidatorSet = ValidatorSet {unValidatorSet :: S.Set Validator} deriving (Generic, Eq, Data, Show, Ord)

instance NFData ValidatorSet

instance ToJSONKey ValidatorSet

instance FromJSONKey ValidatorSet

instance Semigroup ValidatorSet where
  (ValidatorSet cm) <> _ = ValidatorSet cm

instance Monoid ValidatorSet where
  mempty = ValidatorSet (S.empty)
  mappend = (<>)

instance Format ValidatorSet where
  format = show

data Validator
  = CommonName Text Text Text Bool
  deriving (Generic, Eq, Data, Show, Ord, Read)

instance ToJSONKey Validator

instance FromJSONKey Validator

instance PrintfArg Validator where
  formatArg =
    formatString
      . ( \case
            CommonName o u c a -> "COMMONNAME" ++ T.unpack o ++ T.unpack u ++ T.unpack c ++ (show a)
        )

instance ToSchema Validator where
  declareNamedSchema proxy =
    genericDeclareNamedSchema cmpsSchemaOptions proxy
      & mapped . schema . description ?~ "Validator"
      & mapped . schema . example ?~ toJSON exCMPSRespone

exCMPSRespone :: Validator
exCMPSRespone = CommonName "BlockApps" "Engineering" "Admin" True

-- | The model's field modifiers will match the JSON instances
cmpsSchemaOptions :: SchemaOptions
cmpsSchemaOptions =
  SchemaOptions
    { fieldLabelModifier = camelCase . dropFPrefix,
      constructorTagModifier = id,
      datatypeNameModifier = id,
      allNullaryToStringTag = True,
      unwrapUnaryRecords = True
    }

instance NFData Validator where
  rnf (CommonName a b c d) = d `seq` c `seq` b `seq` a `seq` ()

instance Format Validator where
  format = show

instance Binary ValidatorSet

instance Binary Validator

instance RLPSerializable ValidatorSet where
  rlpEncode (ValidatorSet cms) = rlpEncode $ S.toList cms
  rlpDecode x = ValidatorSet . S.fromList $ rlpDecode x

instance RLPSerializable Validator where
  rlpEncode (CommonName a b c d) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, rlpEncode d]
  rlpDecode (RLPArray [a, b, c, d]) = CommonName (rlpDecode a) (rlpDecode b) (rlpDecode c) (rlpDecode d)
  rlpDecode _ = error ("Error in rlpDecode for Validator: bad RLPObject")

instance RLPSerializable (S.Set Validator) where
  rlpEncode s = RLPArray $ rlpEncode <$> (S.toList s)
  rlpDecode (RLPArray cs) = S.fromList (rlpDecode <$> cs)
  rlpDecode x = error $ "rlpDecode for SignedCertificate Set failed: expected RLPArray, got " ++ show x

instance Arbitrary ValidatorSet where
  arbitrary = genericArbitrary

instance Arbitrary Validator where
  arbitrary = GR.genericArbitrary GR.uniform
{-
instance ToSchema ValidatorSet where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "ValidatorSet") mempty
-}
instance FromJSON ValidatorSet where
  parseJSON (A.Array xs) = ValidatorSet . S.fromList <$> traverse parseJSON (V.toList xs)
  parseJSON x = fail $ "couldn't parse JSON for chain members info: " ++ show x

instance ToJSON ValidatorSet where
  toJSON (ValidatorSet xs) = toJSON (S.toList xs)

-- traverse A.Array V.fromList
--  V.fromList <$> traverse A.Array toJSON

instance FromJSON Validator where
--  parseJSON (A.String s) = pure $ Org s True
  parseJSON (Object o) = do
    a <- fromMaybe True <$> (o .:? "access")
    c <- o .:? "commonName"
    pure $ CommonName "" "" (fromMaybe "" c) a
  parseJSON o = fail $ "parseJSON ValidatorSetParsedSet failed: expected object, got: " ++ show o

instance ToJSON Validator where
  toJSON (CommonName o u c a) = object ["orgName" .= o, "orgUnit" .= u, "commonName" .= c, "access" .= a]
