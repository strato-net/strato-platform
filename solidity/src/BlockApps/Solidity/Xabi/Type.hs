{-# LANGUAGE
    DeriveGeneric
  , OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Solidity.Xabi.Type where

import Data.Aeson
import Data.Int (Int32)
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()






              

data XabiType =
  XabiType {
    xabiTypeType::Maybe Text
  , xabiTypeTypedef::Maybe Text
  , xabiTypeDynamic::Maybe Bool
  , xabiTypeSigned::Maybe Bool
  , xabiTypeBytes::Maybe Int32
  , xabiTypeEntry::Maybe XabiType
  , xabiTypeLength::Maybe Word
  , xabiTypeValue::Maybe XabiType
  , xabiTypeKey::Maybe XabiType
    } deriving (Eq, Show, Generic)

instance FromJSON XabiType where
  parseJSON =
    withObject "xabi" $ \v -> do
      theType <- v .:? "type"
      typedef <- v .:? "typedef"
      dynamic <- v .:? "dynamic"
      signed <- v .:? "signed"
      bytes <- v .:? "bytes"
      entry <- v .:? "entry"
      length' <- v .:? "length"
      val <- v .:? "value"
      key <- v .:? "key"
      return
        XabiType {
        xabiTypeType = theType,
        xabiTypeTypedef = typedef, 
        xabiTypeDynamic = dynamic, 
        xabiTypeSigned = signed, 
        xabiTypeBytes = bytes, 
        xabiTypeEntry = entry, 
        xabiTypeLength = length',
        xabiTypeValue = val, 
        xabiTypeKey = key
        }
    
instance ToJSON XabiType where
  toJSON XabiType{..} = object
    [ "type" .= xabiTypeType
    , "typedef" .= xabiTypeTypedef
    , "dynamic" .= xabiTypeDynamic
    , "signed" .= xabiTypeSigned
    , "bytes" .= xabiTypeBytes
    , "entry" .= xabiTypeEntry
    , "value" .= xabiTypeValue
    , "key" .= xabiTypeKey
    ]

instance Arbitrary XabiType where arbitrary = genericArbitrary uniform


data IndexedXabiType =
  IndexedXabiType {
    indexedXabiTypeIndex::Int32,
    indexedXabiTypeType::XabiType
    } deriving (Eq, Show, Generic)

instance FromJSON IndexedXabiType where
  parseJSON = 
    withObject "xabi" $ \v -> do
      index <-  v .: "index"
      theType <- v .:? "type"
      typedef <- v .:? "typedef"
      dynamic <- v .:? "dynamic"
      signed <- v .:? "signed"
      bytes <- v .:? "bytes"
      entry <- v .:? "entry"
      length' <- v .:? "length"
      val <- v .:? "value"
      key <- v .:? "key"
      return $ IndexedXabiType index
        XabiType {
        xabiTypeType = theType,
        xabiTypeTypedef = typedef, 
        xabiTypeDynamic = dynamic, 
        xabiTypeSigned = signed, 
        xabiTypeBytes = bytes, 
        xabiTypeEntry = entry, 
        xabiTypeLength = length',
        xabiTypeValue = val, 
        xabiTypeKey = key
        }
 
         
instance ToJSON IndexedXabiType where
  toJSON (IndexedXabiType index XabiType{..}) = object
    [ "index" .= index
    , "type" .= xabiTypeType
    , "typedef" .= xabiTypeTypedef
    , "dynamic" .= xabiTypeDynamic
    , "signed" .= xabiTypeSigned
    , "bytes" .= xabiTypeBytes
    , "entry" .= xabiTypeEntry
    , "value" .= xabiTypeValue
    , "key" .= xabiTypeKey
    ]

    
instance Arbitrary IndexedXabiType where arbitrary = genericArbitrary uniform
  
data VarType =
  VarType {
    varTypeAtBytes::Int32
  , varTypeType::XabiType
    } deriving (Eq, Show, Generic)

instance FromJSON VarType where
  parseJSON =
    withObject "xabi" $ \v -> do
      atBytes <-  v .: "atBytes"
      theType <- v .:? "type"
      typedef <- v .:? "typedef"
      dynamic <- v .:? "dynamic"
      signed <- v .:? "signed"
      bytes <- v .:? "bytes"
      entry <- v .:? "entry"
      length' <- v .:? "length"
      val <- v .:? "value"
      key <- v .:? "key"
      return $ VarType atBytes
        XabiType {
        xabiTypeType = theType,
        xabiTypeTypedef = typedef, 
        xabiTypeDynamic = dynamic, 
        xabiTypeSigned = signed, 
        xabiTypeBytes = bytes, 
        xabiTypeEntry = entry, 
        xabiTypeLength = length',
        xabiTypeValue = val, 
        xabiTypeKey = key
        }

instance ToJSON VarType where
  toJSON (VarType varTypeAtBytes XabiType{..}) = object
    [ "atBytes" .= varTypeAtBytes
    , "type" .= xabiTypeType
    , "typedef" .= xabiTypeTypedef
    , "dynamic" .= xabiTypeDynamic
    , "signed" .= xabiTypeSigned
    , "bytes" .= xabiTypeBytes
    , "entry" .= xabiTypeEntry
    , "value" .= xabiTypeValue
    , "key" .= xabiTypeKey
    ]




instance Arbitrary VarType where arbitrary = genericArbitrary uniform

