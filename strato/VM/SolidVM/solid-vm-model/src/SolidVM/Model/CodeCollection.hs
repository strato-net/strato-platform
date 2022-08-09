{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE RecordWildCards #-}
-- {-# LANGUAGE NoMonomorphismRestriction #-}

module SolidVM.Model.CodeCollection (
  CodeCollectionF(..),
  CodeCollection,
  flFuncs,
  contracts,
  getParents,
  flConstants,
  flStructs,
  flEnums,  
  librarys,
  interfaces,
  -- getFunctions,
  -- getallFunctions,
  module SolidVM.Model.CodeCollection.Interface,
  module SolidVM.Model.CodeCollection.Library,
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
-- import Control.Monad (msum)
import GHC.Generics

import           Blockchain.SolidVM.Exception

import           SolidVM.Model.CodeCollection.ConstantDecl
import           SolidVM.Model.CodeCollection.Contract
import           SolidVM.Model.CodeCollection.Library 
import           SolidVM.Model.CodeCollection.Interface
--import qualified SolidVM.Model.CodeCollection.Def as Def
import           SolidVM.Model.CodeCollection.Event
import           SolidVM.Model.CodeCollection.Function
import           SolidVM.Model.CodeCollection.Statement
--import           SolidVM.Model.CodeCollection.Type
import           SolidVM.Model.CodeCollection.VarDef
import           SolidVM.Model.CodeCollection.VariableDecl
import           SolidVM.Model.SolidString

-- ___________________________________________________FOR FUTURE USE _____________________________________________
-- getParents :: CodeCollectionF a -> ContractF a -> SolidEither a [(Either3 (ContractF a) (InterfaceF a) (LibraryF a))]
-- getParents cc c = 
--   let toErr x p = maybe (Left ( InternalError "contract parent does not exist" (labelToString p)
--                               , x
--                               ))
--                         Right
--   in for (c ^. parents) $ \p ->
--        toErr (c ^. contractContext) p (msum [Red <$> (M.lookup p $ cc ^. contracts), White <$> (M.lookup p $ cc ^. interfaces), Blue <$> (M.lookup p $ cc ^. librarys)])

-- getFunctions :: Either3 (ContractF a) (InterfaceF a) (LibraryF a) -> Map SolidString (FuncF a)
-- getFunctions = \case
--   Red c -> c ^. functions
--   White i -> i ^. interFunctions
--   Blue l -> l ^. libFunctions

-- getallFunctions :: [Either3 (ContractF a) (InterfaceF a) (LibraryF a)] -> Map SolidString (FuncF a)
-- getallFunctions = foldr (\x acc -> case x of
--                                   Red c -> (c ^. functions) <> acc
--                                   White i -> (i ^. interFunctions) <> acc
--                                   Blue l -> (l ^. libFunctions) <> acc
--                                   ) M.empty


-- data Either3 a b c = Red a | White b | Blue c  deriving (Show, Eq, Generic, Functor)

data CodeCollectionF a =
  CodeCollection {
    _contracts :: Map SolidString (ContractF a),
    _flFuncs :: Map SolidString (FuncF a),
    _flConstants ::  Map SolidString (ConstantDeclF a),
    _flEnums :: Map SolidString ([SolidString], a),
    _flStructs :: Map SolidString [(SolidString, FieldType, a)],
    _interfaces :: Map SolidString (InterfaceF a),
    _librarys :: Map SolidString (LibraryF a) -- pronounced (lie - brahr - is) /lī/ brɑr ˈɛnɛnɛ/

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
