{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Solidity.Xabi.Def where

import           Control.Lens                 (mapped, (&), (?~))
import           Data.Aeson
import           Data.Aeson.TH
-- import qualified Data.Map.Ordered             as OMap
-- import           Data.Map.Strict              (Map)
import           Data.Swagger
import           Data.Text                    (Text)
import           Generic.Random.Generic
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()


import qualified BlockApps.Solidity.Xabi.Type as Xabi

-- instance (Ord k, Arbitrary k, Arbitrary v) => Arbitrary (OMap.OMap k v) where
--   arbitrary = arbitrary >>= return . OMap.fromList
-- 
-- instance (ToJSON k, ToJSON v) => ToJSON (OMap.OMap k v) where
--   toJSON = genericToJSON defAesonOptions . OMap.assocs
-- 
-- instance (FromJSON v) => FromJSON (OMap.OMap Text v) where
--   parseJSON (Array a) = fmap (OMap.fromList . foldr (++) [] )traverse parseJSON o
--   parseJSON v          = typeMismatch "OMap Text a" v
-- 
-- instance (ToSchema k, ToSchema v) => ToSchema (OMap.OMap k v) where
--   declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy

defAesonOptions :: Options
defAesonOptions = defaultOptions{sumEncoding=defaultTaggedObject{tagFieldName="type"}}

data Def = Enum { names::[Text], bytes::Word }
         | Struct { fields::[(Text, Xabi.FieldType)], bytes::Word }
         | Contract { bytes::Word }
         deriving (Eq, Show, Generic)

instance Arbitrary Def where arbitrary = genericArbitrary uniform
instance ToJSON Def where
  toJSON = genericToJSON defAesonOptions
instance FromJSON Def where
  parseJSON = genericParseJSON defAesonOptions

instance ToSchema Def where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.name ?~ "TypeDef"
    & mapped.schema.description ?~ "User defined type (Struct or Enum)"
    & mapped.schema.example ?~ toJSON (Enum ["SUCCESS", "FAILURE", "NOT_AUTHORIZED"] 0xdeadbeef)
