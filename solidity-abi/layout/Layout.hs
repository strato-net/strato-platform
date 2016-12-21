-- |
-- Module: Layout
-- Description: Function for assigning storage locations to variables and
--   types in a parsed contract.
-- Maintainer: Ryan Reich <ryan@blockapps.net>
module Layout (makeContractsLayout) where

import qualified Data.Map as Map

import Data.Maybe

import DefnTypes
import ParserTypes
import LayoutTypes

-- | 'makeContractsLayout' analyzes the ordered list of global storage
-- variables and assigns them byte locations in the blockchain contract's
-- storage.
--
-- Here are the rather picky rules for this:
-- 
-- * Every type has a size.  Most of the basic types have fixed sizes, in
-- many cases given in the declaration, but a few of them are "dynamic",
-- meaning that their actual values are stored in runtime-determined
-- storage locations.  Nonetheless, these also have sizes for the purpose
-- of this layout; their size is always 32 bytes.
-- * In general, variables are laid out contiguously in order of
-- declaration.  This includes fields of structs and elements of arrays.
-- * The first exception to this is that no variable may cross a 32-byte
-- boundary.  If it would, it gets moved to the next 32-byte slot.
-- * The second exception to this is that struct and array variables always
-- start and end in their own 32-byte slot.  That is, they start on
-- a 32-byte boundary and the following variable does as well.
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
  Enum names' -> EnumLayout (ceiling $ logBase (256::Double) $ fromIntegral $ length names')
  Using contract name ->
    UsingLayout (typeUsedBytes $ getType name $ typesLayout (getContract contract contractsL))
    where
      getContract contract' = Map.findWithDefault (error $ "contract " ++ show contract' ++ " not found in contractsL") contract'
      getType name' = Map.findWithDefault (error $ "type " ++ show name' ++ "not found in typesLayout") name'
  Struct fields' ->
    let objsLayout' = makeObjsLayout typesL fields'
        lastEnd = objEndBytes $ getObj (objName $ last fields') objsLayout' 
        getObj name' = Map.findWithDefault (error $ "struct name " ++ show name' ++ " not found in objsLayout'") name'
        usedBytes = nextLayoutStart lastEnd keyBytes        
    in StructLayout objsLayout' usedBytes

makeObjsLayout :: SolidityTypesLayout -> [SolidityObjDef] -> SolidityObjsLayout
makeObjsLayout typesL objs =
  let objsLf = mapMaybe (makeObjLayout typesL) objs
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
  in  if startKey0 == endKey0
      then thisStart0
      else thisStart1
