-- |
-- Module: DefnTypes
-- Description: Types to describe a contract after inheritance is resolved
--   and the structure is fully known.
-- Maintainer: Ryan Reich <ryan@blockapps.net>
module DefnTypes where

import Data.Function
import qualified Data.List as List
import qualified Data.Map as Map
import Data.Map (Map)
import Data.Monoid
import Data.Maybe

import Imports
import ParserTypes

-- | A shorthand, and not a well-named one.
type IdentT a = Map Identifier a

-- | This type is fairly redundant with 'SolidityContract' and will be
-- removed.  It represents the state of a contract post-inheritance.
data SolidityContractDef =
  ContractDef {
    objsDef :: SolidityObjsDef,
    typesDef :: SolidityTypesDef,
    inherits :: [(ContractName, SolidityContractDef)]
    } deriving (Show)
-- | Collection of contracts
type SolidityContractsDef = IdentT SolidityContractDef
-- | Collection of types
type SolidityTypesDef = IdentT SolidityNewType
-- | Collection of variables and functions, order important.
type SolidityObjsDef = [SolidityObjDef]

-- | This instance handles combining a derived and base contract with
-- variables in the correct order.
instance Monoid SolidityContractDef where
  mappend (ContractDef o1 t1 i1) (ContractDef o2 t2 i2) =
    -- o2 o1 is important : objects of the base come before objects of derived
    ContractDef (List.unionBy ((==) `on` objName) o2 o1) (t1 `Map.union` t2) (i1 ++ i2)
  mempty = ContractDef [] Map.empty []

-- | Resolves inheritance among contracts in a set of source files with
-- import requests.  This can be tricky and I am not sure we do it right.
makeFilesDef :: Map FileName SolidityFile -> Either ImportError (Map FileName SolidityContractsDef)
makeFilesDef files = do
  acyclicFiles <- validateImports $ Map.mapKeys collapse files
  let resultPairs = Map.mapWithKey (makeContractsDef resultTrans) acyclicFiles
      resultTrans = Map.map (snd <$>) resultPairs
  sequence $ Map.map (fst <$>) resultPairs

-- | Resolves inheritance among a set of contracts, given the memoized
-- result of all resolved files.  Laziness ensures we handle each file
-- before any one importing it; we verify that there are no cycles at the
-- beginning of 'makeFilesDef'.
makeContractsDef :: Map FileName (Either ImportError SolidityContractsDef) ->
                    FileName ->
                    SolidityFile -> 
                    Either ImportError (SolidityContractsDef, SolidityContractsDef)
makeContractsDef fileDefEs fileName (SolidityFile contracts imports) = do
  importDefs <- getImportDefs fileName fileDefEs imports
  let
    getContractDef (name, _) = (name, Map.findWithDefault (error $ "Couldn't find base contract named " ++ name) name allDefs)
    contractToDef (Contract name objs types bases) =
      (name, ContractDef objs (makeTypesDef types) (map getContractDef bases))
    contractDefs = Map.fromList $ map contractToDef contracts
    allDefs = importDefs `Map.union` contractDefs

    contractTypes' =
      makeTypesDef $ map (\(name, _) -> TypeDef name ContractT) $ Map.toList allDefs
    finalize (ContractDef objsD typesD bases) = 
      ContractDef objsD (typesD `Map.union` contractTypes') bases
  
    result = Map.map finalize $ c3Linearized contractDefs importDefs
  return (result, result `Map.union` importDefs)

-- | This basically does nothing but create a map from a list.
makeTypesDef :: [SolidityTypeDef] -> SolidityTypesDef
makeTypesDef types = Map.fromList $ map typeToTuple types
  where typeToTuple (TypeDef name decl) = (name, decl)

-- | Implementation of the \"C3 linearization algorithm" for ordering bases
-- in a multiple inheritance situation.
c3Linearized :: SolidityContractsDef -> SolidityContractsDef -> SolidityContractsDef
c3Linearized contracts imports = result
  where result = Map.map (c3Linearize $ imports `Map.union` result) contracts

-- | Algorithm is: put the current contract at the front of the list, then
-- merge all the direct bases and put them afterwards.  There is definitely
-- a bug in this implementation, though it probably isn't important in the
-- really simple situations we've seen so far.
c3Linearize :: SolidityContractsDef -> SolidityContractDef -> SolidityContractDef
c3Linearize c3Contracts contract =
  contract{inherits = []} <> c3Merge (map c3Lookup $ inherits contract)
  where c3Lookup (name, _) = (name, Map.findWithDefault (error $ "Couldn't find base contract named " ++ name ++ " while linearizing") name c3Contracts)

-- | How to merge a set of contracts whose inheritance has already been
-- resolved.  Basically, pick the most derived of the transitive bases that
-- isn't a base of anything else, and put it up front, then remove it
-- everywhere it appears and continue.
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
      all (name `notElem`) $
      map (map fst . tail' . inherits . snd) contracts
    
    tail' [] = []
    tail' l = tail l
    head' [] = Nothing
    head' l = Just (head l)


