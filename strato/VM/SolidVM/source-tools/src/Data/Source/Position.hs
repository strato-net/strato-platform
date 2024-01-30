{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Data.Source.Position
  ( SourcePosition (..),
    sourcePositionName,
    sourcePositionLine,
    sourcePositionColumn,
    initialPosition,
    toSourcePosition,
    fromSourcePosition,
    getSourcePosition,
  )
where

import Control.DeepSeq (NFData)
import Control.Lens hiding ((.=))
import Data.Aeson
import Data.Binary
import Data.Data
import Data.Default
import GHC.Generics
import Test.QuickCheck
import Text.Parsec
import Text.Parsec.Pos

data SourcePosition = SourcePosition
  { _sourcePositionName :: String,
    _sourcePositionLine :: !Int,
    _sourcePositionColumn :: !Int
  }
  deriving (Show, Eq, Ord, Generic, Data, NFData)

makeLenses ''SourcePosition

instance Binary SourcePosition

instance ToJSON SourcePosition where
  toJSON pos =
    object
      [ "name" .= _sourcePositionName pos,
        "line" .= _sourcePositionLine pos,
        "column" .= _sourcePositionColumn pos
      ]

instance FromJSON SourcePosition where
  parseJSON (Object o) = do
    name <- o .: "name"
    line <- o .: "line"
    column <- o .: "column"
    pure $ SourcePosition name line column
  parseJSON o = fail $ "parseJSON SourcePosition: expected Object, got " ++ show o

instance Arbitrary SourcePosition where
  arbitrary = SourcePosition <$> arbitrary <*> arbitrary <*> arbitrary

instance Default SourcePosition where
  def = initialPosition ""

initialPosition :: String -> SourcePosition
initialPosition name = SourcePosition name 0 0

toSourcePosition :: SourcePos -> SourcePosition
toSourcePosition pos =
  SourcePosition
    (sourceName pos)
    (sourceLine pos)
    (sourceColumn pos)

fromSourcePosition :: SourcePosition -> SourcePos
fromSourcePosition (SourcePosition n l c) = newPos n l c

getSourcePosition :: Monad m => ParsecT s u m SourcePosition
getSourcePosition = toSourcePosition <$> getPosition
