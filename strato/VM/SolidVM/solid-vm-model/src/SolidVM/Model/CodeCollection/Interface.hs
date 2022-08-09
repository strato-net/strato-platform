{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}

module SolidVM.Model.CodeCollection.Interface (
  InterfaceF(..),
  Interface,
  interfaceName,
  interFunctions,
  interVmVersion,
  interfaceContext,
  interEvents
  ) where

import Control.Lens
import Data.Aeson as A
import Data.Map (Map)
import Data.Source
import GHC.Generics

import           SolidVM.Model.CodeCollection.Function
import           SolidVM.Model.SolidString
import qualified SolidVM.Model.CodeCollection.Event as SolidVM


data InterfaceF a =
  Interface {
    _interfaceName :: SolidString,
    _interFunctions :: Map SolidString (FuncF a),
    _interEvents :: Map SolidString (SolidVM.EventF a),
    _interVmVersion :: String,
    _interfaceContext :: a
  } deriving (Show, Generic, Functor, Eq)

instance ToJSON a => ToJSON (InterfaceF a)
instance FromJSON a => FromJSON (InterfaceF a)

type Interface = Positioned InterfaceF

makeLenses ''InterfaceF
