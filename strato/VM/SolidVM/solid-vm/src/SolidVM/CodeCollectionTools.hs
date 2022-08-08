{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}

module SolidVM.CodeCollectionTools (
  xabiToContract,
  xabiToSUnitIntermediary,
  applyInheritance,
  resolveLabels,
  SUnitIntermediary(..)
  ) where

import Control.Lens
import Data.Map (Map)
import qualified Data.Map as M
import Data.Source

import           Blockchain.SolidVM.Exception


import           SolidVM.Model.CodeCollection
import qualified SolidVM.Model.CodeCollection.Def as Def
import           SolidVM.Model.SolidString
import qualified SolidVM.Model.Type               as SVMType

import           SolidVM.Solidity.Xabi
import qualified SolidVM.Solidity.Xabi as Xabi

type SolidEither = Either (Positioned ((,) SolidException))

data SUnitIntermediary = Con Contract | FLC ConstantDecl | FLS Def.Def | FLE Def.Def | Lib Library | Intr Interface deriving (Show, Eq)

xabiToContract :: SolidString -> [SolidString] -> String -> Xabi -> Contract
xabiToContract contractName' parents' vmVersion' xabi = Contract {
  -- validateXabi xabi
  -- constr <- case M.toList $ Xabi.xabiConstr xabi of
  --   [] -> Right Nothing
  --   [(_, x)] -> Right $ Just x
  --   _ -> Left $ ( DuplicateDefinition "multiple constructors in contract" (show contractName') --TODO- figure out if this is allowed in Solidity
  --               , Xabi.xabiContext xabi
  --               ) 
  -- This was here forever ^^ but I don't think it was ever even reachable in the first place because we already check if there are multiple constructors in Declarations.hs
  _contractName = contractName',
  _parents = parents',
  _storageDefs = Xabi.xabiVars xabi,
  _constants = Xabi.xabiConstants xabi,
  _enums = M.fromList [(name, (vals, a)) | (name, Def.Enum vals _ a) <- M.toList $ Xabi.xabiTypes xabi],
  _structs = M.fromList [(name, (\(k,v) -> (k,v,a)) <$> vals) | (name, Def.Struct vals _ a) <- M.toList $ Xabi.xabiTypes xabi],
  _events = Xabi.xabiEvents xabi,
  _functions = Xabi.xabiFuncs xabi,
  _modifiers = Xabi.xabiModifiers xabi,
  _constructor = case M.toList $ Xabi.xabiConstr xabi of
    [(_, x)] -> Just x
    _ -> Nothing, --TODO- This in theory can be reached if there are multiple constructors in the contract. but in practice so long as the check is still in Declarations.hs, this should never happen.
  _vmVersion = vmVersion',
  _contractContext = Xabi.xabiContext xabi
  }

xabiToSUnitIntermediary :: SolidString -> [SolidString] -> String -> Xabi -> SUnitIntermediary 
xabiToSUnitIntermediary contractName' parents' vmVersion' xabi = do 
  case Xabi.xabiKind xabi of 
    Xabi.ContractKind -> Con $ xabiToContract contractName' parents' vmVersion' xabi 
    Xabi.LibraryKind -> Lib $ Library {
      _libraryName = contractName',
      _libraryContext = Xabi.xabiContext xabi,
      _libFunctions = Xabi.xabiFuncs xabi,
      _libModifiers = Xabi.xabiModifiers xabi,
      _libEnums = M.fromList [(name, (vals, a)) | (name, Def.Enum vals _ a) <- M.toList $ Xabi.xabiTypes xabi],
      _libStructs = M.fromList [(name, (\(k,v) -> (k,v,a)) <$> vals) | (name, Def.Struct vals _ a) <- M.toList $ Xabi.xabiTypes xabi],
      _libEvents = Xabi.xabiEvents xabi,
      _libVmVersion = vmVersion'
      }
    Xabi.InterfaceKind -> Intr $ Interface {
      _interfaceName = contractName',
      _interfaceContext = Xabi.xabiContext xabi,
      _interFunctions = Xabi.xabiFuncs xabi,
      _interVmVersion = vmVersion'
      }

-- getContextFuncOfSUnit :: SUnitIntermediary -> SourceAnnotation ()
-- getContextFuncOfSUnit (Con c) = _contractContext c
-- getContextFuncOfSUnit (Lib l) = _libraryContext l
-- getContextFuncOfSUnit (Intr i) = _interfaceContext i
-- getContextFuncOfSUnit (FLC c) = constContext c
-- getContextFuncOfSUnit (FLS c) = Def.context c
-- getContextFuncOfSUnit (FLE c) = Def.context c



-- validateXabi :: Xabi -> SolidEither ()
-- validateXabi _ = Right ()

{-
validateXabi :: Xabi -> SolidEither ()
validateXabi Xabi{xabiModifiers=mx, xabiContext=ctx} =
  case M.size mx of
      0 -> Right ()
      _ -> Left $ ( TODO "modifiers not supported by solidvm" (show mx)
                  , ctx
                  )
-}

applyInheritance :: CodeCollection -> SolidEither CodeCollection
applyInheritance cc = do
  ccs <- traverse (addInheritedObjects cc) $ cc^.contracts
  pure $ cc{
    _contracts = ccs
  }

addInheritedObjects :: CodeCollection -> Contract -> SolidEither Contract
addInheritedObjects cc c = do
  fu <- toUnionMaker _functions cc c
  sd <- toUnionMaker _storageDefs cc c
  en <- toUnionMaker _enums cc c
  st <- toUnionMaker _structs cc c
  ev <- toUnionMaker _events cc c
  co <- toUnionMaker _constants cc c
  pure $ c{
  _functions=fu,
  _storageDefs=sd,
  _enums=en,
  _structs=st,
  _events = ev,
  _constants=co
  }

toUnionMaker :: (Ord a) => (Contract -> M.Map a b) -> CodeCollection -> Contract -> SolidEither (M.Map a b)
toUnionMaker f cc c = do
  parents' <- getParents cc c
  parentMaps <- traverse (toUnionMaker f cc) parents'
  pure . M.unions $ f c : parentMaps



resolveLabels :: CodeCollection -> CodeCollection
resolveLabels cc = cc{_contracts=fmap (resolveLabelsInContract cc) $ cc^.contracts}


resolveLabelsInContract :: CodeCollection -> Contract -> Contract
resolveLabelsInContract cc c =
  c{_storageDefs=fmap (resolveLabelsInDef (cc^.contracts) (c^.enums) (c^.structs)) $ c^.storageDefs}

resolveLabelsInDef :: Map SolidString Contract -> Map SolidString a -> Map SolidString b -> VariableDecl -> VariableDecl
resolveLabelsInDef contractDefs enumDefs structDefs x@VariableDecl{varType=SVMType.UnknownLabel labelName _} =
  case (labelName `M.member` contractDefs,
        labelName `M.member` structDefs,
        labelName `M.member` enumDefs) of
    (_, True, _) -> x{varType=SVMType.Enum Nothing labelName Nothing}
    (_, _, True) -> x{varType=SVMType.Struct Nothing labelName}
    (True, _, _) -> x{varType=SVMType.Contract labelName}
    _ -> x{varType=SVMType.UnknownLabel labelName Nothing}
    -- _ -> error $ "unknown label in call to resolveLabelsInDef: " ++ labelName
resolveLabelsInDef _ _ _ x = x
