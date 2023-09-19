{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module SolidVM.Solidity.StaticAnalysis.Contracts.ParentConstructors
  ( detector,
  )
where

import Data.Functor ((<&>))
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe)
import qualified Data.Set as S
import Data.Source
import Data.Text (Text)
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString
import SolidVM.Solidity.StaticAnalysis.Types

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector cc@CodeCollection {..} = M.foldMapWithKey (contractHelper cc) _contracts

contractHelper :: CodeCollection -> SolidString -> Contract -> [SourceAnnotation Text]
contractHelper cc cName c =
  fromMaybe [] $
    _constructor c <&> \constr ->
      let parentSet = S.fromList $ _parents c
          constrCalls = _funcConstructorCalls constr
       in flip M.foldMapWithKey constrCalls $ \parentName varExprs ->
            if not $ parentName `S.member` parentSet
              then [("Contract " <> labelToText cName <> " does not inherit from " <> labelToText parentName) <$ _funcContext constr]
              else case M.lookup parentName (_contracts cc) of
                Nothing -> [("Contract " <> labelToText parentName <> " not found.") <$ _funcContext constr]
                Just parent -> case _constructor parent of
                  Nothing -> [(labelToText parentName <> "'s constructor is undefined. Please consider defining its constructor.") <$ _funcContext constr]
                  Just pConstr ->
                    let pConstrArgs = _funcArgs pConstr
                     in if length pConstrArgs /= length varExprs
                          then [("The number of arguments in the constructor call to " <> labelToText parentName <> " does not equal the number of arguments in its constructor definition.") <$ _funcContext constr]
                          else [] -- we'll leave typechecking the arguments for a different detector
