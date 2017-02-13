module LayoutTypes where

import qualified Data.Map as Map
import Data.Map (Map)

import qualified Data.List as List

import Data.Function
import Data.Monoid
import Data.Maybe
import Numeric.Natural

import ParserTypes

type IdentT a = Map Identifier a

data SolidityContractDef =
  ContractDef {
    objsDef :: SolidityObjsDef,
    typesDef :: SolidityTypesDef,
    inherits :: [(ContractName, SolidityContractDef)]
    } deriving (Eq,Show)
type SolidityContractsDef = IdentT SolidityContractDef
type SolidityTypesDef = IdentT SolidityNewType
type SolidityObjsDef = [SolidityObjDef]

instance Monoid SolidityContractDef where
  mappend (ContractDef o1 t1 i1) (ContractDef o2 t2 i2) =
    -- o2 o1 is important : objects of the base come before objects of derived
    ContractDef (List.unionBy ((==) `on` objName) o2 o1) (t1 `Map.union` t2) (i1 ++ i2)
  mempty = ContractDef [] Map.empty []

makeContractsDef :: [SolidityContract] -> SolidityContractsDef
makeContractsDef contracts = Map.map finalize $ c3Linearized contractDefs
  where
    contractDefs = Map.fromList $ map contractToDef contracts
    contractToDef (Contract name objs types bases) =
      (name, ContractDef objs (makeTypesDef types) (map getContractDef bases))
    getContractDef (name, _) = (name, contractDefs Map.! name)
    finalize (ContractDef objsD typesD bases) =
      ContractDef objsD (typesD `Map.union` contractTypes') bases
    contractTypes' = makeTypesDef $ do
      Contract{contractName = name} <- contracts
      return $ TypeDef name ContractT

makeTypesDef :: [SolidityTypeDef] -> SolidityTypesDef
makeTypesDef types = Map.fromList $ map typeToTuple types
  where typeToTuple (TypeDef name decl) = (name, decl)

c3Linearized :: SolidityContractsDef -> SolidityContractsDef
c3Linearized contracts = result
  where result = Map.map (c3Linearize result) contracts

c3Linearize :: SolidityContractsDef -> SolidityContractDef -> SolidityContractDef
c3Linearize c3Contracts contract =
  contract{inherits = []} <> c3Merge (map c3Lookup $ inherits contract)
  where c3Lookup (name, _) = (name, c3Contracts Map.! name)

c3Merge :: [(ContractName, SolidityContractDef)] -> SolidityContractDef
c3Merge [] = mempty
c3Merge contracts = c3Head <> c3Merge c3Tail
  where
    (headName, c3Head) = contracts !! c3Index
    c3Tail = catMaybes $ do
      (name, contract) <- contracts
      let cPurge = filter (\(n', _) -> headName /= n') $ inherits contract
      if headName == name
        then return $ do
        (n', c') <- head' cPurge
        return (n', c'{inherits = tail' cPurge})
        else return $ Just (name, contract{inherits = cPurge})
    c3Index = fromMaybe (error "Contract inheritance cannot be linearized") $
              List.findIndex isC3Head contracts
    isC3Head (name, _) =
      all (\names' -> not $ name `elem` names') $
      map (map fst . tail' . inherits . snd) contracts

    tail' [] = []
    tail' l = tail l
    head' [] = Nothing
    head' l = Just (head l)

type SolidityFileLayout = SolidityContractsLayout
type SolidityContractsLayout = IdentT SolidityContractLayout
type SolidityObjsLayout = IdentT SolidityObjLayout
type SolidityTypesLayout = IdentT SolidityTypeLayout

data SolidityContractLayout =
  ContractLayout {
    objsLayout :: SolidityObjsLayout,
    typesLayout :: SolidityTypesLayout
    }
  deriving (Eq,Show)

data SolidityObjLayout =
  ObjLayout {
    objStartBytes :: StorageBytes,
    objEndBytes :: StorageBytes
    }
  deriving (Eq,Show)

data SolidityTypeLayout =
  StructLayout {
    structFieldsLayout :: SolidityObjsLayout,
    typeUsedBytes :: StorageBytes
    } |
  EnumLayout {
    typeUsedBytes :: StorageBytes
    } |
  UsingLayout {
    typeUsedBytes :: StorageBytes
    } |
  ContractTLayout {
    typeUsedBytes :: StorageBytes
    }
  deriving (Eq,Show)

type StorageKey = Natural
type StorageBytes = Natural

addressBytes :: StorageBytes
addressBytes = 20

keyBytes :: StorageBytes
keyBytes = 32

bytesToKey :: StorageBytes -> StorageKey
bytesToKey = (`quot` keyBytes)

keyToBytes :: StorageKey -> StorageBytes
keyToBytes = (* keyBytes)
