{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Strato.Model.Validator
  ( 
    Validator (..),
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Control.DeepSeq
import Control.Lens.Operators ((?~), (&))
import Data.Aeson hiding (Array, String)
import Data.Binary
import Data.Data
import Data.Maybe (fromMaybe)
import Data.Swagger hiding (Format, format, get, put)
import GHC.Generics
import qualified Generic.Random as GR
import Test.QuickCheck.Arbitrary
import Test.QuickCheck.Instances.Text ()
import Text.Format

newtype Validator = Validator Address deriving (Generic, Eq, Data, Show, Ord, Read)

instance RLPSerializable Validator where
  rlpEncode (Validator v) = rlpEncode v
  rlpDecode v = Validator $ rlpDecode v

instance NFData Validator where
  rnf (Validator c) = c `seq` ()

instance Format Validator where
  format (Validator c) = format c

instance ToSchema Validator where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "Validator")
        ( mempty
            & type_ ?~ SwaggerString
            & example ?~ "validator=admin.blockapps.com"
            & description ?~ "STRATO Validator name, typically the domain name of the peer acting as a validator"
        )


instance Binary Validator

instance Arbitrary Validator where
  arbitrary = GR.genericArbitrary GR.uniform

instance FromJSON Validator where
  parseJSON (Object o) = do
    c <- o .:? "commonName"
    pure $ Validator $ fromMaybe 0x0 c
  parseJSON o = fail $ "parseJSON ValidatorSetParsedSet failed: expected object, got: " ++ show o

instance ToJSON Validator where
  toJSON (Validator c) = object ["commonName" .= c]

