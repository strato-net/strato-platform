{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}

module ProcessSimpleTypes where

import SolidityStateTypes
import qualified Data.Map as Map
import qualified Data.Vector as VV

import Numeric.Natural

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.Layout hiding (StorageKey)

import Data.Maybe
import Data.Word

primitiveValueLabel :: PrimitiveStateVariable -> Map.Map StorageKey StorageValue -> PrimitiveStateValue
primitiveValueLabel psv state =
  convertSingleValue
    (extractSolidityType psv)
    (extractSingleKey theKey startIndex endIndex state)
  where theKey = head . objectLayout2StorageKeys $ primObjLayout psv
        theIndices = extractKeySubIndices psv
        startIndex = fst theIndices
        endIndex = snd theIndices


extractSolidityType :: PrimitiveStateVariable -> SolidityBasicType
extractSolidityType
  (
    PrimitiveStateVariable
      (
        ObjDef
          _
          (SingleValue theType)
          _
          _
      )
      _
      _
      _
  ) = theType

extractSolidityType _ = error "can't extract solidity type"

extractKeySubIndices :: PrimitiveStateVariable -> (StartIndex,EndIndex)
extractKeySubIndices pv = (startInd,endInd)
  where startInd = fromIntegral $ objStartBytes theLayout `mod` maxByteIndex
        endInd   = fromIntegral $ objEndBytes theLayout `mod` maxByteIndex
        theLayout = primObjLayout pv

convertSingleValue
  :: SolidityBasicType
  -> VV.Vector Word8
  -> PrimitiveStateValue
convertSingleValue Boolean storage =
  SolBool ((storage VV.! 0) /= 0)
convertSingleValue Address store =
  AddressBytes (Bytes20 store)
convertSingleValue (FixedBytes n) store = Bytes theBytes
  where
    theBytes =
      case n of
       1 -> Bytes1 store
       2 -> Bytes2 store
       3 -> Bytes3 store
       4 -> Bytes4 store
       5 -> Bytes5 store
       6 -> Bytes6 store
       7 -> Bytes7 store
       8 -> Bytes8 store

       9 -> Bytes9 store
       10 -> Bytes10 store
       11 -> Bytes11 store
       12 -> Bytes12 store
       13 -> Bytes13 store
       14 -> Bytes14 store
       15 -> Bytes15 store
       16 -> Bytes16 store

       17 -> Bytes17 store
       18 -> Bytes18 store
       19 -> Bytes19 store
       20 -> Bytes20 store
       21 -> Bytes21 store
       22 -> Bytes22 store
       23 -> Bytes23 store
       24 -> Bytes24 store

       25 -> Bytes25 store
       26 -> Bytes26 store
       27 -> Bytes27 store
       28 -> Bytes28 store
       29 -> Bytes29 store
       30 -> Bytes30 store
       31 -> Bytes31 store
       32 -> Bytes32 store

       _  -> error "bytes not in range 1-32"

convertSingleValue (SignedInt n) store = SolInt theInt
  where
    theInt =
      case n of
       1 -> (Int8 $ vector2Word8 store)
       2 -> (Int16 $ vector2Word16 store)
       3 -> (Int24 $ vector2Word24 store)
       4 -> (Int32 $ vector2Word32 store)
       5 -> (Int40 $ vector2Word40 store)
       6 -> (Int48 $ vector2Word48 store)
       7 -> (Int56 $ vector2Word56 store)
       8 -> (Int64 $ vector2Word64 store)

       9 -> (Int72 $ vector2Word72 store)
       10 -> (Int80 $ vector2Word80 store)
       11 -> (Int88 $ vector2Word88 store)
       12 -> (Int96 $ vector2Word96 store)
       13 -> (Int104 $ vector2Word104 store)
       14 -> (Int112 $ vector2Word112 store)
       15 -> (Int120 $ vector2Word120 store)
       16 -> (Int128 $ vector2Word128 store)

       17 -> (Int136 $ vector2Word136 store)
       18 -> (Int144 $ vector2Word144 store)
       19 -> (Int152 $ vector2Word152 store)
       20 -> (Int160 $ vector2Word160 store)
       21 -> (Int168 $ vector2Word168 store)
       22 -> (Int176 $ vector2Word176 store)
       23 -> (Int184 $ vector2Word184 store)
       24 -> (Int192 $ vector2Word192 store)

       25 -> (Int200 $ vector2Word200 store)
       26 -> (Int208 $ vector2Word208 store)
       27 -> (Int216 $ vector2Word216 store)
       28 -> (Int224 $ vector2Word224 store)
       29 -> (Int232 $ vector2Word232 store)
       30 -> (Int240 $ vector2Word240 store)
       31 -> (Int248 $ vector2Word248 store)
       32 -> (Int256 $ vector2Word256 store)

       _  -> error "int length not in range 1-32"

convertSingleValue (UnsignedInt n) store = SolUInt theUInt
  where
    theUInt =
      case n of
       1 -> (UInt8 $ vector2Word8 store)
       2 -> (UInt16 $ vector2Word16 store)
       3 -> (UInt24 $ vector2Word24 store)
       4 -> (UInt32 $ vector2Word32 store)
       5 -> (UInt40 $ vector2Word40 store)
       6 -> (UInt48 $ vector2Word48 store)
       7 -> (UInt56 $ vector2Word56 store)
       8 -> (UInt64 $ vector2Word64 store)

       9 -> (UInt72 $ vector2Word72 store)
       10 -> (UInt80 $ vector2Word80 store)
       11 -> (UInt88 $ vector2Word88 store)
       12 -> (UInt96 $ vector2Word96 store)
       13 -> (UInt104 $ vector2Word104 store)
       14 -> (UInt112 $ vector2Word112 store)
       15 -> (UInt120 $ vector2Word120 store)
       16 -> (UInt128 $ vector2Word128 store)

       17 -> (UInt136 $ vector2Word136 store)
       18 -> (UInt144 $ vector2Word144 store)
       19 -> (UInt152 $ vector2Word152 store)
       20 -> (UInt160 $ vector2Word160 store)
       21 -> (UInt168 $ vector2Word168 store)
       22 -> (UInt176 $ vector2Word176 store)
       23 -> (UInt184 $ vector2Word184 store)
       24 -> (UInt192 $ vector2Word192 store)

       25 -> (UInt200 $ vector2Word200 store)
       26 -> (UInt208 $ vector2Word208 store)
       27 -> (UInt216 $ vector2Word216 store)
       28 -> (UInt224 $ vector2Word224 store)
       29 -> (UInt232 $ vector2Word232 store)
       30 -> (UInt240 $ vector2Word240 store)
       31 -> (UInt248 $ vector2Word248 store)
       32 -> (UInt256 $ vector2Word256 store)

       _  -> error "uint length not in range 1-32"

convertSingleValue _ _ = error "unrecognized SolidityBasicType"

solidityTypeLength :: SolidityBasicType -> Natural
solidityTypeLength Boolean = 1
solidityTypeLength Address = 20
solidityTypeLength (SignedInt n) = n
solidityTypeLength (UnsignedInt un) = un
solidityTypeLength (FixedBytes bn) = bn
solidityTypeLength (FixedArray theType n) = solidityTypeLength theType * n
solidityTypeLength _ = error "given solidity type doesn't have a fixed length"

startKey :: SolidityObjLayout -> StorageKey
startKey objLayout'' = fromIntegral $ objStartBytes objLayout'' `div` maxByteIndex

endKey :: SolidityObjLayout -> StorageKey
endKey objLayout''' = fromIntegral $ objEndBytes objLayout''' `div` maxByteIndex


emptyValue = VV.fromList []

extractSingleKey :: StorageKey -> StartIndex -> EndIndex -> Map.Map StorageKey StorageValue -> StorageValue
extractSingleKey key start end state =
  fromMaybe
    emptyValue
    (
      fmap
        (
          VV.reverse
            .
          VV.slice
            (fromIntegral $ start `mod` maxByteIndex)
            (fromIntegral $ end - start + 1)
            .
          VV.reverse
        )
        (Map.lookup
          key
          state)
    )

extractKeyRange :: StartKey -> EndKey -> Map.Map StorageKey StorageValue -> FlattenedStorageValue
extractKeyRange start end state =
  ManyKeys $
    catMaybes
      (Prelude.map
        (\k -> Map.lookup k state)
        [ start .. end ])

keyInRange :: SolidityObjLayout -> StorageKey -> Bool
keyInRange layout''' k = (k >= (fromIntegral $ ((objStartBytes layout''') `div` maxByteIndex)))
                      && (k <= (fromIntegral $ ((objEndBytes layout''') `div` maxByteIndex)))


objectLayout2StorageKeys :: SolidityObjLayout -> [StorageKey]
objectLayout2StorageKeys objLayout'''' =
  [
    (fromIntegral $ (objStartBytes objLayout'''') `div` maxByteIndex)
    ..
    (fromIntegral $ (objEndBytes objLayout'''') `div` maxByteIndex)
  ]

findRelevantStorage :: SolidityStateVariable -> SolidityUnlabeledState -> Map.Map StorageKey StorageValue
findRelevantStorage (PrimitiveVariable var) state =
  Prelude.foldr
    (\k theMap -> Map.insert
                   k
                   (fromMaybe
                     (VV.fromList [])
                     (Map.lookup k
                       (unlabeledState state)))
                  theMap)

    Map.empty
    (objectLayout2StorageKeys
      (primObjLayout var))
findRelevantStorage (ComplexVariable _) _   = error "complex variable storage not defined yet"

lookupObjectLayout :: SolidityObjDef -> SolidityContractLayout -> Maybe SolidityObjLayout
lookupObjectLayout obj contractLayout = Map.lookup (objName obj)
                                                   (objsLayout contractLayout)

contract2StateVariables :: SolidityContract -> SolidityContractLayout -> [SolidityStateVariable]
contract2StateVariables contract contractLayout =
  Prelude.map
    (\solObj -> (PrimitiveVariable $
                  PrimitiveStateVariable
                    solObj
                    (fromMaybe
                      (error $ "layout not found: " ++ (show solObj))
                      (lookupObjectLayout solObj contractLayout))
                    (contractName contract)
                    Nothing))
    (filterObjsForVariables $ contractObjs contract)


filterObjsForVariables :: [SolidityObjDef]->[SolidityObjDef]
filterObjsForVariables = Prelude.filter (isSingleValue . objValueType)

isSingleValue :: SolidityTuple -> Bool
isSingleValue (SingleValue (Typedef _ )) = False
isSingleValue (SingleValue _ ) = True
isSingleValue _ = False

lookupContracts :: SolidityFile -> SolidityFileLayout -> [SolidityContractLayout]
lookupContracts file layout'''' =
  catMaybes $
    Prelude.map
      (\contract ->
        (Map.lookup (contractName contract) layout''''))
      file

extractVariables :: SolidityFile -> [SolidityStateVariable]
extractVariables file =
  Prelude.concat $
    Prelude.zipWith
     contract2StateVariables
     file
     (lookupContracts
        file
        (layout file))
