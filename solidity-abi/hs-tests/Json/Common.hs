module Json.Common where

import Data.Aeson hiding (json)
import Data.Map (Map)

import qualified Data.Map as Map
import qualified Data.Set as Set

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.External.JSON
import Parser.Common (parserStage)
import Test.Combinators
import Test.Common
import Test.ErrorMessages

type ValueVerifier = Value -> Assertion
type JSONTestInput = (String, Map FileName SourceCode, ValueVerifier)

jsonTest :: JSONTestInput -> TestTree
jsonTest (name, files, tester) = makeTest name tester $ jsonStage name files

jsonStage :: FileName -> Map FileName SourceCode -> TestM Value
jsonStage name files = do
  parsed <- sequence $ Map.mapWithKey parserStage files
  Right $ either id id $ jsonABI name parsed

jsonHasContracts :: FileName -> [ContractName] -> Value -> Assertion
jsonHasContracts fName cNames json =
  Set.fromList cNames == Set.fromList (Map.keys jsonMap)
  |! fileError fName ## theError

  where 
    jsonMap :: Map ContractName Value 
    jsonMap = case fromJSON json of
      Error s -> error s
      Success x -> x
    theError = isMissingError $ "contracts" ## show cNames

jsonTestInput :: [FileName] -> [SourceCode] -> [ContractName] -> JSONTestInput
jsonTestInput names sources cNames = (name, files, tester) where
  name = head names
  files = Map.fromList $ zip names sources
  tester = jsonHasContracts name cNames
