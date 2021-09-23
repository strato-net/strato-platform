{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}
module Data.Source.Annotation
  ( SourceAnnotation(..)
  ) where

import           Control.Lens              hiding ((.=))
import           Data.Aeson                as Aeson
import           Data.Data
import           Data.Source.Position
import           Data.Swagger
import           Data.Text                 (Text)
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances ()

data SourceAnnotation a = SourceAnnotation
  { _sourceAnnotationStart      :: SourcePosition
  , _sourceAnnotationEnd        :: SourcePosition
  , _sourceAnnotationAnnotation :: a
  } deriving (Eq, Show, Generic, Functor, Data)

instance ToJSON a => ToJSON (SourceAnnotation a) where
  toJSON ann = object [
    "start" .= _sourceAnnotationStart ann,
    "end" .= _sourceAnnotationEnd ann,
    "annotation" .= _sourceAnnotationAnnotation ann
    ]

instance FromJSON a => FromJSON (SourceAnnotation a) where
  parseJSON (Object o) = do
    start <- o .: "start"
    end <- o .: "end"
    ann <- o .: "annotation"
    pure $ SourceAnnotation start end ann
  parseJSON o = fail $ "parseJSON SourceAnnotation: expected Object, got " ++ show o

instance Arbitrary a => Arbitrary (SourceAnnotation a) where
  arbitrary = SourceAnnotation <$> arbitrary <*> arbitrary <*> arbitrary

instance ToSchema (SourceAnnotation Text) where
  declareNamedSchema _ = return $ NamedSchema (Just "SourceAnnotation")
    ( mempty
      & type_ ?~ SwaggerString
      & example ?~ toJSON (SourceAnnotation (SourcePosition "A.sol" 41 0)
                                            (SourcePosition "A.sol" 41 13)
                                            ("Unknown identifier: centralization" :: Text))
      & description ?~ "SourceAnnotation" )