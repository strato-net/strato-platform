{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.StaticAnalysis.Contracts.ParentConstructors
  ( detector
  ) where

import           SolidVM.Model.CodeCollection
import           Data.Functor  ((<&>))
import qualified Data.Map.Strict as M
import           Data.Maybe      (fromMaybe)
import           Data.Source
import qualified Data.Set        as S
import           Data.Text       (Text)
import qualified Data.Text       as T

import           SolidVM.Solidity.StaticAnalysis.Types



-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector cc@CodeCollection{..} = M.foldMapWithKey (contractHelper cc) _contracts

contractHelper :: CodeCollection -> String -> Contract -> [SourceAnnotation Text]
contractHelper cc cName c = fromMaybe [] $ _constructor c <&> \constr ->
  let parentSet = S.fromList $ _parents c
      constrCalls = funcConstructorCalls constr
   in flip M.foldMapWithKey constrCalls $ \parentName varExprs ->
        if not $ parentName `S.member` parentSet
          then [("Contract " <> T.pack cName <> " does not inherit from " <> T.pack parentName) <$ funcContext constr]
          else case M.lookup parentName (_contracts cc) of
            Nothing -> [("Contract " <> T.pack parentName <> " not found.") <$ funcContext constr]
            Just parent -> case _constructor parent of
              Nothing -> [(T.pack parentName <> "'s constructor is undefined. Please consider defining its constructor.") <$ funcContext constr]
              Just pConstr ->
                let pConstrArgs = funcArgs pConstr
                 in if length pConstrArgs /= length varExprs
                      then [("The number of arguments in the constructor call to " <> T.pack parentName <> " does not equal the number of arguments in its constructor definition.") <$ funcContext constr]               
                      else [] -- we'll leave typechecking the arguments for a different detector
