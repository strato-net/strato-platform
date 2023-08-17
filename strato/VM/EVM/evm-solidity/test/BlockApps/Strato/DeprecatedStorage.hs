{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

--{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}

module BlockApps.Strato.DeprecatedStorage
  ( Storage (..),
    StorageKV (..),
  )
where

-- TODO: Unify Bloch and Strato transactions
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.ExtendedWord
import Control.Monad
import Data.Aeson
import Data.Aeson.Types
import Data.Swagger
import Data.Swagger.Internal.Schema (named)
import qualified Data.Text as Text
import GHC.Generics
import Generic.Random
import Numeric
import Servant.API
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Text.Read
import Text.Read.Lex

newtype Hex n = Hex {unHex :: n} deriving (Eq, Generic, Ord)

instance (Integral n, Show n) => Show (Hex n) where
  show (Hex n) = showHex (toInteger n) ""

instance (Eq n, Num n) => Read (Hex n) where
  readPrec = Hex <$> readP_to_Prec (const readHexP)

--I'm not sure what `d` precision parameter is used for

instance ToSchema (Hex Word256) where
  declareNamedSchema = const . pure $ named "hex word256" binarySchema

instance Num n => FromJSON (Hex n) where
  parseJSON value = do
    string <- parseJSON value
    case fmap fromInteger (readMaybe ("0x" ++ string)) of
      Nothing -> fail $ "not hex encoded: " ++ string
      Just n -> return $ Hex n

instance (Integral n, Show n) => ToJSON (Hex n) where
  toJSON = toJSON . show

instance Arbitrary x => Arbitrary (Hex x) where
  arbitrary = genericArbitrary uniform

instance (ToHttpApiData a) => ToHttpApiData [a] where
  toUrlPiece = Text.pack . show . map toUrlPiece

instance FromHttpApiData Word256 where
  parseUrlPiece text = case readMaybe (Text.unpack text) of
    Nothing -> Left $ "Could not decode Word256: " <> text
    Just (Hex w256) -> Right w256

data StorageKV
  = EVMEntry (Hex Word256) (Hex Word256)
  | SolidVMEntry HexStorage HexStorage
  deriving (Eq, Show, Generic, ToSchema)

instance Arbitrary StorageKV where
  arbitrary = liftM2 EVMEntry arbitrary arbitrary

data Storage = Storage
  { storageAddress :: Address,
    storageKV :: StorageKV,
    storageChainId :: Maybe ChainId,
    storageKind :: CodeKind
  }
  deriving (Eq, Show, Generic, ToSchema)

instance FromJSON Storage where
  parseJSON (Object o) = do
    addr <- o .: "address"
    chain <- o .:? "chain_id"
    codeKind <- o .:? "kind" .!= EVM
    kv <- case codeKind of
      EVM -> liftM2 EVMEntry (o .: "key") (o .: "value")
      SolidVM -> liftM2 SolidVMEntry (o .: "key") (o .: "value")
    return $ Storage addr kv chain codeKind
  parseJSON x = typeMismatch "Storage" x

instance ToJSON Storage where
  toJSON Storage {..} =
    let (t, k, v) =
          case storageKV of
            EVMEntry k' v' -> ("kind" .= EVM, "key" .= k', "value" .= v')
            SolidVMEntry k' v' -> ("kind" .= SolidVM, "key" .= k', "value" .= v')
        a = "address" .= storageAddress
        c_id = case storageChainId of
          Nothing -> []
          Just c_id' -> ["chain_id" .= c_id']
     in object $ a : t : k : v : c_id
