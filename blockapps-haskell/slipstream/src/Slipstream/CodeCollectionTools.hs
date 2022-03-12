
--This should eventually moved into the code that parses solidvm code.
--For now, only slipstream is using it, so I'm writing and debugging it here.

module Slipstream.CodeCollectionTools where

import Control.Lens
import Data.Map (Map)
import qualified Data.Map as M
import qualified Data.Text as T

import SolidVM.Model.CodeCollection
import SolidVM.Model.CodeCollection.VariableDecl
import qualified SolidVM.Solidity.Xabi.Type               as Xabi

resolveLabels :: CodeCollection -> CodeCollection
resolveLabels cc = cc{_contracts=fmap (resolveLabelsInContract cc) $ cc^.contracts}


resolveLabelsInContract :: CodeCollection -> Contract -> Contract
resolveLabelsInContract cc c =
  c{_storageDefs=fmap (resolveLabelsInDef (cc^.contracts) (c^.enums) (c^.structs)) $ c^.storageDefs}

resolveLabelsInDef :: Map String Contract -> Map String a -> Map String b -> VariableDecl -> VariableDecl
resolveLabelsInDef contractDefs enumDefs structDefs x@VariableDecl{varType=Xabi.Label labelName} =
  case (labelName `M.member` contractDefs,
        labelName `M.member` structDefs,
        labelName `M.member` enumDefs) of
    (_, True, _) -> x{varType=Xabi.Enum Nothing (T.pack labelName) Nothing}
    (_, _, True) -> x{varType=Xabi.Struct Nothing (T.pack labelName)}
    (True, _, _) -> x{varType=Xabi.Contract $ T.pack labelName}
    _ -> x{varType=Xabi.Label labelName}
    -- _ -> error $ "unknown label in call to resolveLabelsInDef: " ++ labelName
resolveLabelsInDef _ _ _ x = x
