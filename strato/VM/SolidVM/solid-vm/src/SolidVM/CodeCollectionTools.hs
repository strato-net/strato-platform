{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module SolidVM.CodeCollectionTools
  ( xabiToContract,
    applyInheritanceNoFunctions,
    applyInheritanceFunctions,
    resolveLabels,
  )
where

import Blockchain.SolidVM.Exception
import Control.Lens
import Data.Bool (bool)
import Data.Map (Map)
import qualified Data.Map as M
import Data.Source
import SolidVM.Model.CodeCollection
import qualified SolidVM.Model.CodeCollection.Def as Def
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Xabi
import qualified SolidVM.Solidity.Xabi as Xabi

type SolidEither = Either (Positioned ((,) SolidException))

xabiToContract :: SolidString -> [SolidString] -> M.Map String String -> Xabi -> SolidEither Contract
xabiToContract contractName' parents' userDefinedTypes xabi = do
  validateXabi xabi
  constr <- case M.toList $ Xabi._xabiConstr xabi of
    [] -> Right Nothing
    [(_, x)] -> Right $ Just x
    _ ->
      Left $
        ( DuplicateDefinition "multiple constructors in contract" (show contractName'), --TODO- figure out if this is allowed in Solidity
          Xabi._xabiContext xabi
        )
  pure
    Contract
      { _contractName = contractName',
        _parents = parents',
        _storageDefs = Xabi._xabiVars xabi,
        _userDefined = userDefinedTypes,
        _constants = Xabi._xabiConstants xabi,
        _enums = M.fromList [(name, (vals, a)) | (name, Def.Enum vals _ a) <- M.toList $ Xabi._xabiTypes xabi],
        _structs = M.fromList [(name, (\(k, v) -> (k, v, a)) <$> vals) | (name, Def.Struct vals _ a) <- M.toList $ Xabi._xabiTypes xabi],
        _errors = M.fromList [(name, (\(k, v) -> (k, v, a)) <$> vals) | (name, Def.Error vals _ a) <- M.toList $ Xabi._xabiTypes xabi],
        _events = Xabi._xabiEvents xabi,
        _functions = Xabi._xabiFuncs xabi,
        _modifiers = Xabi._xabiModifiers xabi,
        _usings = Xabi._xabiUsing xabi,
        _constructor = constr,
        _contractType = case (Xabi._xabiKind xabi) of
          Xabi.ContractKind -> ContractType
          Xabi.LibraryKind -> LibraryType
          Xabi.AbstractKind -> AbstractType
          Xabi.InterfaceKind -> InterfaceType,
        _importedFrom = Nothing,
        _contractContext = Xabi._xabiContext xabi
      }

validateXabi :: Xabi -> SolidEither ()
validateXabi _ = Right ()

{-
validateXabi :: Xabi -> SolidEither ()
validateXabi Xabi{xabiModifiers=mx, xabiContext=ctx} =
  case M.size mx of
      0 -> Right ()
      _ -> Left $ ( TODO "modifiers not supported by solidvm" (show mx)
                  , ctx
                  )
-}

applyInheritanceNoFunctions :: CodeCollection -> SolidEither CodeCollection
applyInheritanceNoFunctions cc = do
  ccs <- traverse (addInheritedObjects cc) $ cc ^. contracts
  pure $
    cc
      { _contracts = ccs
      }

applyInheritanceFunctions :: CodeCollection -> SolidEither CodeCollection
applyInheritanceFunctions cc = do
  ccs <- traverse (addInheritedFunctions cc) $ cc ^. contracts
  pure $
    cc
      { _contracts = ccs
      }

addInheritedObjects :: CodeCollection -> Contract -> SolidEither Contract
addInheritedObjects cc c = do
  sd <- toUnionMaker _storageDefs cc c
  ud <- toUnionMaker _userDefined cc c
  en <- toUnionMaker _enums cc c
  st <- toUnionMaker _structs cc c
  ev <- toUnionMaker _events cc c
  co <- toUnionMaker _constants cc c
  mo <- toUnionMaker _modifiers cc c
  pure $
    c
      { _storageDefs = sd,
        _userDefined = ud,
        _enums = en,
        _structs = st,
        _events = ev,
        _constants = co,
        _modifiers = mo
      }

addInheritedFunctions :: CodeCollection -> Contract -> SolidEither Contract
addInheritedFunctions cc c = do
  fu <- toUnionMaker' _functions (bool id (M.filter ((/= Just Private) . _funcVisibility)) (usesStrictModifiers cc) . _functions) cc c
  pure $
    c
      { _functions = fu
      }

toUnionMaker :: (Ord a) => (Contract -> M.Map a b) -> CodeCollection -> Contract -> SolidEither (M.Map a b)
toUnionMaker f = toUnionMaker' f f

toUnionMaker' :: (Ord a) => (Contract -> M.Map a b) -> (Contract -> M.Map a b) -> CodeCollection -> Contract -> SolidEither (M.Map a b)
toUnionMaker' fSelf fAncestors cc c = do
  parents' <- getParents cc c
  parentMaps <- traverse (toUnionMaker' fAncestors fAncestors cc) parents' -- this allows us to perform fSelf only once
  pure . M.unions $ fSelf c : parentMaps

resolveLabels :: CodeCollection -> CodeCollection
resolveLabels cc = cc {_contracts = fmap (resolveLabelsInContract cc) $ cc ^. contracts}

--TODO Figured out how to make UserDefined Work with this in the intented way
resolveLabelsInContract :: CodeCollection -> Contract -> Contract
resolveLabelsInContract cc c =
  c {_storageDefs = fmap (resolveLabelsInDef (cc ^. contracts) (c ^. userDefined) (c ^. enums) (c ^. structs)) $ c ^. storageDefs}

resolveLabelsInDef :: Map SolidString Contract -> Map String String -> Map SolidString a -> Map SolidString b -> VariableDecl -> VariableDecl
resolveLabelsInDef contractDefs userDefineDefs enumDefs structDefs x@VariableDecl {_varType = SVMType.UnknownLabel labelName _} =
  case ( labelName `M.member` contractDefs,
         labelName `M.member` userDefineDefs,
         labelName `M.member` structDefs,
         labelName `M.member` enumDefs
       ) of
    (_, _, _, True) -> x {_varType = SVMType.Enum Nothing labelName Nothing}
    (_, _, True, _) -> x {_varType = SVMType.Struct Nothing labelName}
    (True, _, _, _) -> x {_varType = SVMType.Contract labelName}
    _ -> x {_varType = SVMType.UnknownLabel labelName Nothing}
-- _ -> error $ "unknown label in call to resolveLabelsInDef: " ++ labelName
resolveLabelsInDef _ _ _ _ x = x
