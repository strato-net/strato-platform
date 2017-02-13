module Layout (
  layout,
  SolidityFileLayout, SolidityContractsLayout,
  SolidityTypesLayout, SolidityObjsLayout,
  SolidityContractLayout(..), SolidityTypeLayout(..),
  SolidityObjLayout(..),
  StorageBytes
  ) where

import qualified Data.Map as Map

import Data.Maybe

import ParserTypes
import LayoutTypes

layout :: SolidityFile -> SolidityFileLayout
layout = makeContractsLayout . makeContractsDef

makeContractsLayout :: SolidityContractsDef -> SolidityContractsLayout
makeContractsLayout contracts = contractsL
  where contractsL = Map.map (makeContractLayout contractsL) contracts

makeContractLayout :: SolidityContractsLayout -> SolidityContractDef
                      -> SolidityContractLayout
makeContractLayout contractsL (ContractDef objs types _) =
  ContractLayout {
    objsLayout = makeObjsLayout typesL objs,
    typesLayout = typesL
    }
  where typesL = Map.map (makeTypeLayout contractsL typesL) types

makeTypeLayout :: SolidityContractsLayout -> SolidityTypesLayout -> SolidityNewType
                   -> SolidityTypeLayout
makeTypeLayout contractsL typesL t = case t of
  ContractT -> ContractTLayout addressBytes
  Enum names' -> EnumLayout (ceiling $ logBase (8::Double) $ fromIntegral $ length names')
  Using contract name ->
    UsingLayout (typeUsedBytes $ typesLayout (contractsL Map.! contract) Map.! name)
  Struct fields' ->
    let objsLayout' = makeObjsLayout typesL fields'
        lastEnd = objEndBytes $ objsLayout' Map.! (objName $ last fields')
        usedBytes = nextLayoutStart lastEnd keyBytes
    in StructLayout objsLayout' usedBytes

makeObjsLayout :: SolidityTypesLayout -> [SolidityObjDef] -> SolidityObjsLayout
makeObjsLayout typesL objs =
  let objsLf = catMaybes $ map (makeObjLayout typesL) objs
      objOffEnds = 0:map ((+1) . objEndBytes . snd) objsL
      objsL = zipWith ($) objsLf objOffEnds
  in Map.fromList  objsL

makeObjLayout :: SolidityTypesLayout -> SolidityObjDef
                 -> Maybe (StorageBytes -> (Identifier, SolidityObjLayout))
makeObjLayout typesL obj = case obj of
  ObjDef{objName = name, objArgType = NoValue, objValueType = SingleValue t} ->
    Just $ \lastOffEnd ->
    let startBytes = nextLayoutStart lastOffEnd $ usedBytes t
    in (name,
        ObjLayout {
          objStartBytes = startBytes,
          objEndBytes = startBytes + usedBytes t - 1
          })
  _ -> Nothing
  where
    usedBytes ty = case ty of
      Boolean -> 1
      Address -> addressBytes
      SignedInt b -> b
      UnsignedInt b -> b
      FixedBytes b -> b
      DynamicBytes -> keyBytes
      String -> keyBytes
      FixedArray typ l -> keyBytes * numKeys
        where
          elemSize = usedBytes typ
          (newEach, numKeys) =
            if elemSize <= 32
            then (32 `quot` elemSize,
                  l `quot` newEach + (if l `rem` newEach == 0 then 0 else 1))
            else (1, l * (elemSize `quot` 32)) -- always have rem = 0
      DynamicArray _ -> keyBytes
      Mapping _ _ -> keyBytes
      Typedef name -> typeUsedBytes $ Map.findWithDefault err name typesL
        where err = error $
                    "Name " ++ name ++ " is not a user-defined type or contract"


nextLayoutStart :: StorageBytes -> StorageBytes -> StorageBytes
nextLayoutStart 0 _ = 0
nextLayoutStart lastOffEnd thisSize =
  let thisStart0 = lastOffEnd
      lastEnd = lastOffEnd - 1
      thisEnd0 = lastEnd + thisSize
      startKey0 = bytesToKey thisStart0
      endKey0 = bytesToKey thisEnd0
      lastEndKey = bytesToKey lastEnd
      thisStart1 = keyToBytes $ lastEndKey + 1
  in  if (startKey0 == endKey0)
      then thisStart0
      else thisStart1
