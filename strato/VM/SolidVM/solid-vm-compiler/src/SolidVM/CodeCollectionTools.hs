{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module SolidVM.CodeCollectionTools
  ( applyInheritanceNoFunctions,
    applyInheritanceFunctions,
    checkForNamingCollisions,
    resolveLabels,
  )
where

import Blockchain.SolidVM.Exception
import Control.Lens
import Control.Monad ((<=<))
import Data.Foldable (foldrM)
import Data.Function (on)
import Data.Map (Map)
import qualified Data.Map.Internal as M
import Data.Source
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType

type SolidEither = Either (Positioned ((,) SolidException))

{-
validateXabi :: Xabi -> SolidEither ()
validateXabi Xabi{xabiModifiers=mx, xabiContext=ctx} =
  case M.size mx of
      0 -> Right ()
      _ -> Left $ ( TODO "modifiers not supported by solidvm" (show mx)
                  , ctx
                  )
-}

applyInheritanceNoFunctions :: CodeCollection -> SolidEither CodeCollection
applyInheritanceNoFunctions cc = do
  ccs <- traverse (addInheritedObjects cc) $ cc ^. contracts
  pure $
    cc
      { _contracts = ccs
      }

applyInheritanceFunctions :: CodeCollection -> SolidEither CodeCollection
applyInheritanceFunctions cc = do
  ccs <- traverse (checkForNamingCollisions <=< addInheritedFunctions cc) $ cc ^. contracts
  pure $
    cc
      { _contracts = ccs
      }

addInheritedObjects :: CodeCollection -> Contract -> SolidEither Contract
addInheritedObjects cc c = do
  let typesMatch t u = and $ (\f -> f t u) <$> [(==) `on` _varType, (==) `on` _varIsPublic, (==) `on` (fmap (() <$) . _varInitialVal), (==) `on` _isImmutable, (==) `on` _isRecord]
      matchType k t u = if typesMatch t u
                          then Right $ Just t
                          else Left (TypeError ("Overlapping definitions for " ++ labelToString k ++ " in contract " ++ labelToString (_contractName c))
                                               ("at " ++ show (_varContext t) ++ " and " ++ show (_varContext u)), _varContext t)
  sd <- toUnionMaker' _storageDefs _storageDefs (M.WhenMatched matchType) cc c
  ud <- toUnionMaker _userDefined cc c
  en <- toUnionMaker _enums cc c
  st <- toUnionMaker _structs cc c
  ev <- toUnionMaker _events cc c
  co <- toUnionMaker _constants cc c
  mo <- toUnionMaker _modifiers cc c
  pure $
    c
      { _storageDefs = sd,
        _userDefined = ud,
        _enums = en,
        _structs = st,
        _events = ev,
        _constants = co,
        _modifiers = mo
      }

miss :: M.WhenMissing (Either a) k b b
miss = M.WhenMissing Right . const $ Right . Just

match :: M.WhenMatched (Either a) k b b b
match = M.WhenMatched $ \_ x _ -> Right $ Just x

addInheritedFunctions :: CodeCollection -> Contract -> SolidEither Contract
addInheritedFunctions cc c = do
  fu <- toUnionMaker' _functions (M.filter ((/= Just Private) . _funcVisibility) . _functions) match cc c
  pure $
    c
      { _functions = fu
      }

checkForNamingCollisions :: Contract -> SolidEither Contract
checkForNamingCollisions c = c <$ foldrM check M.empty
  [ M.map _varContext $ _storageDefs c
  , M.map _constContext $ _constants c
  , M.map _funcContext $ _functions c
  , M.map _modifierContext $ _modifiers c
  ]
  where conflict k t u = Left (TypeError ("Multiple definitions for " ++ labelToString k ++ " in contract " ++ labelToString (_contractName c))
                                         ("at " ++ show t ++ " and " ++ show u), t)
        check = M.mergeA miss miss $ M.WhenMatched conflict

toUnionMaker :: (Ord a) => (Contract -> M.Map a b) -> CodeCollection -> Contract -> SolidEither (M.Map a b)
toUnionMaker f = toUnionMaker' f f match

toUnionMaker' :: (Ord a) => (Contract -> M.Map a b) -> (Contract -> M.Map a b) -> (M.WhenMatched SolidEither a b b b) -> CodeCollection -> Contract -> SolidEither (M.Map a b)
toUnionMaker' fSelf fAncestors onConflict cc c = do
  parents' <- getParents cc c
  parentMaps <- traverse (toUnionMaker' fAncestors fAncestors onConflict cc) parents' -- this allows us to perform fSelf only once
  foldrM (M.mergeA miss miss onConflict) M.empty $ fSelf c : parentMaps

resolveLabels :: CodeCollection -> CodeCollection
resolveLabels cc = cc {_contracts = fmap (resolveLabelsInContract cc) $ cc ^. contracts}

--TODO Figured out how to make UserDefined Work with this in the intented way
resolveLabelsInContract :: CodeCollection -> Contract -> Contract
resolveLabelsInContract cc c =
  c {_storageDefs = fmap (resolveLabelsInDef (cc ^. contracts) (c ^. userDefined) (c ^. enums) (c ^. structs)) $ c ^. storageDefs}

resolveLabelsInDef :: Map SolidString Contract -> Map String String -> Map SolidString a -> Map SolidString b -> VariableDecl -> VariableDecl
resolveLabelsInDef contractDefs userDefineDefs enumDefs structDefs x@VariableDecl {_varType = SVMType.UnknownLabel labelName _} =
  case ( labelName `M.member` contractDefs,
         labelName `M.member` userDefineDefs,
         labelName `M.member` structDefs,
         labelName `M.member` enumDefs
       ) of
    (_, _, _, True) -> x {_varType = SVMType.Enum Nothing labelName Nothing}
    (_, _, True, _) -> x {_varType = SVMType.Struct Nothing labelName}
    (True, _, _, _) -> x {_varType = SVMType.Contract labelName}
    _ -> x {_varType = SVMType.UnknownLabel labelName Nothing}
-- _ -> error $ "unknown label in call to resolveLabelsInDef: " ++ labelName
resolveLabelsInDef _ _ _ _ x = x
