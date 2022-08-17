{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}

module SolidVM.CodeCollectionTools (
  xabiToContract,
  applyInheritance,
  resolveLabels
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

xabiToContract :: SolidString -> [SolidString] -> String -> M.Map String String -> Xabi -> SolidEither Contract
xabiToContract contractName' parents' vmVersion' userDefinedTypes xabi = do
  validateXabi xabi
  constr <- case M.toList $ Xabi.xabiConstr xabi of
    [] -> Right Nothing
    [(_, x)] -> Right $ Just x
    _ -> Left $ ( DuplicateDefinition "multiple constructors in contract" (show contractName') --TODO- figure out if this is allowed in Solidity
                , Xabi.xabiContext xabi
                )
  pure Contract {
  _contractName = contractName',
  _parents = parents',
  _storageDefs = Xabi.xabiVars xabi,
  _userDefined =  userDefinedTypes,
  _constants = Xabi.xabiConstants xabi,
  _enums = M.fromList [(name, (vals, a)) | (name, Def.Enum vals _ a) <- M.toList $ Xabi.xabiTypes xabi],
  _structs = M.fromList [(name, (\(k,v) -> (k,v,a)) <$> vals) | (name, Def.Struct vals _ a) <- M.toList $ Xabi.xabiTypes xabi],
  _events = Xabi.xabiEvents xabi,
  _functions = Xabi.xabiFuncs xabi,
  _modifiers = Xabi.xabiModifiers xabi,
  _constructor = constr,
  _vmVersion = vmVersion',
  _contractContext = Xabi.xabiContext xabi
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
  ud <- toUnionMaker _userDefined cc c
  en <- toUnionMaker _enums cc c
  st <- toUnionMaker _structs cc c
  ev <- toUnionMaker _events cc c
  co <- toUnionMaker _constants cc c
  pure $ c{
  _functions=fu,
  _storageDefs=sd,
  _userDefined =ud,
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

--TODO Figured out how to make UserDefined Work with this in the intented way
resolveLabelsInContract :: CodeCollection -> Contract -> Contract
resolveLabelsInContract cc c =
  c{_storageDefs=fmap (resolveLabelsInDef (cc^.contracts) (c^.userDefined)  (c^.enums) (c^.structs)) $ c^.storageDefs}

resolveLabelsInDef :: Map SolidString Contract -> Map String String->  Map SolidString a -> Map SolidString b -> VariableDecl -> VariableDecl
resolveLabelsInDef contractDefs userDefineDefs enumDefs structDefs x@VariableDecl{varType=SVMType.UnknownLabel labelName _} =
  case (labelName `M.member` contractDefs,
        labelName `M.member` userDefineDefs,
        labelName `M.member` structDefs,
        labelName `M.member` enumDefs) of
    (_, _, True, _) -> x{varType=SVMType.Enum Nothing labelName Nothing}
    (_, _,  _, True) -> x{varType=SVMType.Struct Nothing labelName}
    (True, _,  _, _) -> x{varType=SVMType.Contract labelName}
    _ -> x{varType=SVMType.UnknownLabel labelName Nothing}
    -- _ -> error $ "unknown label in call to resolveLabelsInDef: " ++ labelName
resolveLabelsInDef _ _ _ _ x = x
