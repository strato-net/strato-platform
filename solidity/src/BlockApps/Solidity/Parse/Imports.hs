-- |
-- Module: Imports
-- Description: Functions for resolving import declarations
-- Maintainer: Ryan Reich <ryan@blockapps.net>
{-# LANGUAGE DeriveFunctor #-}
module Imports (
  ImportError(..),
  getImportDefs,
  validateImports,
  collapse  
  ) where

import Data.Map (Map)
import qualified Data.Map as Map
import Data.Foldable ()
import Data.Monoid
import Data.Traversable ()
import System.FilePath

import ParserTypes

-- | A logical error type.  We need to report missing imports, at least, so
-- that client code can known to look for them.
data ImportError = 
  ImportCycle {
    importErrMainFile :: FileName
    } |
  MissingImport {
    importErrMainFile :: FileName,
    importErrRelImport :: FileName
    } |
  MissingSymbol {
    importErrMainFile :: FileName,
    importErrSymbol :: Identifier,
    importErrRelImport :: FileName
    }

-- | Given a file with a list of import requests, produces the contracts
-- that those requests import, under the names by which they are imported.
-- Assumes all filenames are collapsed, and all imports are valid
getImportDefs :: FileName ->
                 Map FileName (Either ImportError (Map ContractName a)) ->
                 [(FileName, ImportAs)] ->
                 Either ImportError (Map ContractName a)
getImportDefs mainFileName fileDefsEither imports = do
  imported <- mapM getQualifiedImports imports
  return $ Map.unions imported

  where
    getQualifiedImports (fileName, importAs) = do
      fileDef <- fileDefsEither Map.! relImport
      let symbolDefsEither = Map.map Right fileDef
      changeNames symbolDefsEither
      where
        relImport = mainFilePath <//> fileName
        mainFilePath = takeDirectory mainFileName
        changeNames = case importAs of
          Unqualified -> sequence
          StarPrefix p -> sequence . Map.mapKeys ((p ++ ".") ++)
          Aliases as -> sequence . Map.fromList . flip map as . getSym
            where getSym m (k, x) = (x, getSymbolEither k m)
        getSymbolEither sym =
          Map.findWithDefault (Left $ MissingSymbol mainFileName sym relImport) sym

(<//>) :: FilePath -> FilePath -> FilePath
mp <//> fn = collapse $ prependIfRelative mp fn

prependIfRelative :: FilePath -> FilePath -> FilePath
prependIfRelative mp fn =
  case splitDirectories fn of
    "." : _ -> mp </> fn
    ".." : _ -> mp </> fn
    _ -> fn

-- | Transforms file paths into a canonical form with no . or ..
-- components.  No standard function does this, because removing .. can
-- lead to incorrect paths if the level removed was a symlink.  However, it
-- is necessary for us, because otherwise we may fail to resolve imports
-- that are given under different but synonymous paths.  Thus, it is a bad
-- idea to have symlinks in your source directory structure.
collapse :: FilePath -> FilePath
collapse path = joinPath $ collapse' $ splitDirectories path
  where collapse' [] = []
        collapse' (_ : ".." : rest) = collapse' rest
        collapse' ("." : x : rest) = collapse' $ x : rest
        collapse' (x : rest) = x : collapse' rest

data ImportState a = Go a | Err ImportError | Done deriving (Functor)

instance (Monoid a) => Monoid (ImportState a) where
  mappend x@(Err _) _ = x
  mappend _ x@(Err _) = x
  mappend (Go x) (Go y) = Go (x <> y)
  mappend Done x = x
  mappend x Done = x
  mempty = Done

-- | Checks that the file import graph is actually well-defined and
-- acyclic.
-- Assumes that the filenames are all collapsed
validateImports :: Map FileName SolidityFile -> Either ImportError (Map FileName SolidityFile)
validateImports files = slurp $ Map.map Go $ makeImportsRelative $ Map.map (map fst . fileImports) files
  where
    slurp importStateMap =
      case foldMap (const [] <$>) shiftedStateMap of
        Done -> Right files
        Err e -> Left e
        _ -> slurp shiftedStateMap
      where shiftedStateMap = shift importStateMap

    shift importStateMap = Map.mapWithKey shiftState importStateMap
      where
        shiftState mainFile (Go imports) = checkCycles $ foldMap id $ map getImport imports
          where 
            getImport fileName = Map.findWithDefault (Err $ MissingImport mainFile fileName) fileName importStateMap
            checkCycles x@(Go newImports) = 
              if mainFile `elem` newImports
              then Err $ ImportCycle mainFile
              else x
            checkCycles x = x
        shiftState _ x = x

    makeImportsRelative :: Map FileName [FileName] -> Map FileName [FileName]
    makeImportsRelative = Map.mapWithKey $ \f -> map (takeDirectory f <//>)

