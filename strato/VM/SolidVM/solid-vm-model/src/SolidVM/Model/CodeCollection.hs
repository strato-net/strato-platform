{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE RecordWildCards #-}

module SolidVM.Model.CodeCollection (
  CodeCollectionF(..),
  CodeCollection,
  contracts,
  getParents,
  flConstants,
  flStructs,
  flEnums,  
  
  module SolidVM.Model.CodeCollection.Contract,
  --module SolidVM.Model.CodeCollection.Def,
  module SolidVM.Model.CodeCollection.Function,
  module SolidVM.Model.CodeCollection.Statement,
  module SolidVM.Model.CodeCollection.ConstantDecl,
  --module SolidVM.Model.CodeCollection.Type,
  module SolidVM.Model.CodeCollection.VariableDecl,
  module SolidVM.Model.CodeCollection.Event,
  module SolidVM.Model.CodeCollection.VarDef
  ) where

import Control.Lens
import Data.Aeson as A
import Data.Map (Map)
import qualified Data.Map as M
import Data.Source
import Data.Traversable (for)
import GHC.Generics

import           Blockchain.SolidVM.Exception

import           SolidVM.Model.CodeCollection.ConstantDecl
import           SolidVM.Model.CodeCollection.Contract
--import qualified SolidVM.Model.CodeCollection.Def as Def
import           SolidVM.Model.CodeCollection.Event
import           SolidVM.Model.CodeCollection.Function
import           SolidVM.Model.CodeCollection.Statement
--import           SolidVM.Model.CodeCollection.Type
import           SolidVM.Model.CodeCollection.VarDef
import           SolidVM.Model.CodeCollection.VariableDecl
import           SolidVM.Model.SolidString


data CodeCollectionF a =
  CodeCollection {
    _contracts :: Map SolidString (ContractF a),
    _flConstants ::  Map SolidString (ConstantDeclF a),
    _flEnums :: Map SolidString ([SolidString], a),
    _flStructs :: Map SolidString [(SolidString, FieldType, a)]

  } deriving (Show, Generic, Functor)

instance ToJSON a => ToJSON (CodeCollectionF a)
instance FromJSON a => FromJSON (CodeCollectionF a)

type CodeCollection = Positioned CodeCollectionF

makeLenses ''CodeCollectionF

type SolidEither = Either (Positioned ((,) SolidException))

getParents :: CodeCollection -> Contract -> SolidEither [Contract]
getParents cc c =
  let toErr x p = maybe (Left ( InternalError "contract parent does not exist" (labelToString p)
                              , x
                              ))
                        Right
  in for (c ^. parents) $ \p ->
       toErr (c ^. contractContext) p . M.lookup p $ cc ^. contracts
