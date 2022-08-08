{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}

module SolidVM.Model.CodeCollection.Library (
  LibraryF(..),
  Library,
  libraryName,
  libEnums,
  libStructs,
  libEvents,
  libFunctions,
  libModifiers,
  libVmVersion,
  libraryContext
  ) where

import Control.Lens
import Data.Aeson as A
import Data.Map (Map)
import Data.Source
import GHC.Generics

import qualified SolidVM.Model.CodeCollection.Event as SolidVM
import           SolidVM.Model.CodeCollection.Function
import qualified SolidVM.Model.CodeCollection.VarDef as SolidVM
import           SolidVM.Model.SolidString



-- All library functions must be pure or view if they are to be called from outside the library.

data LibraryF a =
  Library {
    _libraryName :: SolidString,
    _libEnums :: Map SolidString ([SolidString], a),
    _libStructs :: Map SolidString [(SolidString, SolidVM.FieldType, a)],
    _libEvents :: Map SolidString (SolidVM.EventF a),
    _libFunctions :: Map SolidString (FuncF a),
    _libModifiers :: Map SolidString (ModifierF a), --Questionably allowed for only use within the library
    _libVmVersion :: String,
    _libraryContext :: a
  } deriving (Show, Generic, Functor, Eq)

instance ToJSON a => ToJSON (LibraryF a)
instance FromJSON a => FromJSON (LibraryF a)

type Library = Positioned LibraryF

makeLenses ''LibraryF
