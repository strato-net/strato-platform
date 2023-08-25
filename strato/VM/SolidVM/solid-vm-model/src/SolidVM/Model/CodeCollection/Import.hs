{-# LANGUAGE DataKinds          #-}
{-# LANGUAGE DeriveAnyClass     #-}
{-# LANGUAGE DeriveFunctor      #-}
{-# LANGUAGE DeriveGeneric      #-}
{-# LANGUAGE FlexibleInstances  #-}
{-# LANGUAGE OverloadedStrings  #-}
{-# LANGUAGE RecordWildCards    #-}
{-# LANGUAGE TemplateHaskell    #-}
{-# LANGUAGE DeriveFoldable     #-}
{-# LANGUAGE DeriveTraversable  #-}

module SolidVM.Model.CodeCollection.Import
  ( ItemImportF(..)
  , ItemImport
  , FileImportF(..)
  , FileImport
  ) where

import           Control.Lens                 (mapped, (&), (?~), makeLenses)
import           Control.DeepSeq
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Source
import           Data.Swagger
import           Data.Text                    (Text)
import qualified Generic.Random               as GR
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()

import           SolidVM.Model.CodeCollection.Statement

--------------------------------------------------------------------------------
soliditySchemaOptions :: SchemaOptions
soliditySchemaOptions = SchemaOptions
  { fieldLabelModifier = camelCase . dropFPrefix
  , constructorTagModifier = id
  , datatypeNameModifier = id
  , allNullaryToStringTag = True
  , unwrapUnaryRecords = True
  }
--------------------------------------------------------------------------------

data ItemImportF a = Named Text a
                   | Aliased Text Text a
                   deriving (Eq, Show, Generic, Functor, NFData, Foldable, Traversable)

makeLenses ''ItemImportF

instance ToJSON a => ToJSON (ItemImportF a)
instance FromJSON a => FromJSON (ItemImportF a)

instance Arbitrary a => Arbitrary (ItemImportF a) where
  arbitrary = GR.genericArbitrary GR.uniform

type ItemImport = Positioned ItemImportF

instance ToSchema ItemImport where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
     & mapped.name ?~ "ItemImport schema"
     & mapped.schema.description ?~ "Xabi of an item import declaration"
     & mapped.schema.example ?~ toJSON sampleItemImport
     where sampleItemImport :: ItemImportF ()
           sampleItemImport = Aliased "add" "func" ()

-- Changes to this structure should also have changes in the Unparser :)
data FileImportF a = Simple (ExpressionF a) a
                   | Qualified (ExpressionF a) Text a
                   | Braced [ItemImportF a] (ExpressionF a) a
                   deriving (Eq, Show, Generic, Functor, NFData, Foldable, Traversable)

makeLenses ''FileImportF

instance ToJSON a => ToJSON (FileImportF a)
instance FromJSON a => FromJSON (FileImportF a)

instance Arbitrary a => Arbitrary (FileImportF a) where
  arbitrary = GR.genericArbitrary GR.uniform

type FileImport = Positioned FileImportF

-- instance ToSchema FileImport where
--   declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
--      & mapped.name ?~ "FileImport schema"
--      & mapped.schema.description ?~ "Xabi of an file import declaration"
--      & mapped.schema.example ?~ toJSON sampleFileImport
--      where sampleFileImport :: FileImportF ()
--            sampleFileImport = Qualified (StringLiteral () "./Foo.sol") "F" ()