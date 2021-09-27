{-# LANGUAGE DeriveGeneric #-}

module Data.Source.Tools
  ( SourceToolsF(..)
  , SourceTools
  ) where

import Data.Functor.Identity
import Data.Source.Annotation
import Data.Source.Map
import Data.Text              (Text)
import GHC.Generics

data SourceToolsF parse analyze a = SourceTools
  { parser   :: SourceMap -> parse a
  , analyzer :: SourceMap -> analyze [SourceAnnotation Text]
  } deriving (Generic)

type SourceTools = SourceToolsF Identity Identity