{-# LANGUAGE DeriveGeneric #-}

module Data.Source.Tools
  ( SourceToolsF(..)
  , SourceTools
  ) where

import Data.Functor.Identity  (Identity)
import Data.Source.Annotation
import Data.Source.Map
import Data.Source.Severity
import Data.Text              (Text)
import GHC.Generics

data SourceToolsF parse analyze fuzz a = SourceTools
  { parser   :: SourceMap -> parse a
  , analyzer :: SourceMap -> analyze [SourceAnnotation (WithSeverity Text)]
  , fuzzer   :: SourceMap -> fuzz
  } deriving (Generic)

type SourceTools = SourceToolsF (Either [SourceAnnotation Text])
                                Identity
                                (IO (Either [SourceAnnotation Text] ()))