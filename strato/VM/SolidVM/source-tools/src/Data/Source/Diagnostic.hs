{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Data.Source.Diagnostic
  ( SourceDiagnostic (..),
    sourceDiagnosticSeverity,
    sourceDiagnosticMessage,
  )
where

import Control.DeepSeq
import Control.Lens hiding ((.=))
import Data.Aeson hiding (Error)
import Data.Data
import Data.Source.Severity
import Data.Swagger
import Data.Text (Text)
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()

data SourceDiagnostic = SourceDiagnostic
  { _sourceDiagnosticSeverity :: Severity,
    _sourceDiagnosticMessage :: Text
  }
  deriving (Eq, Show, Ord, Generic, Data, NFData, ToJSON, FromJSON)

makeLenses ''SourceDiagnostic

instance Arbitrary SourceDiagnostic where
  arbitrary = SourceDiagnostic <$> arbitrary <*> arbitrary

instance ToSchema SourceDiagnostic where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "SourceDiagnostic")
        ( mempty
            & type_ ?~ SwaggerString
            & example ?~ toJSON (SourceDiagnostic Error "Unknown identifier: centralization")
            & description ?~ "SourceDiagnostic"
        )
