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
import Control.Monad (foldM, (<=<))
import Data.Foldable (foldrM)
import Data.Function (on)
import Data.Map (Map)
import qualified Data.Map.Internal as M
import qualified Data.Set as S
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
  checkInheritance cc
  ccs <- traverse (addInheritedObjects cc) $ cc ^. contracts
  pure $
    cc
      { _contracts = ccs
      }

applyInheritanceFunctions :: CodeCollection -> SolidEither CodeCollection
applyInheritanceFunctions cc = do
  checkInheritance cc
  ccs <- traverse (checkForNamingCollisions <=< addInheritedFunctions cc) $ cc ^. contracts
  pure $
    cc
      { _contracts = ccs
      }

matchType :: Contract -> M.WhenMatched SolidEither SolidString VariableDecl VariableDecl VariableDecl
matchType c = M.WhenMatched $ \k t u ->
  if typesMatch t u
    then Right $ Just t
    else Left (TypeError ("Overlapping definitions for " ++ labelToString k ++ " in contract " ++ labelToString (_contractName c))
                         ("at " ++ show (_varContext t) ++ " and " ++ show (_varContext u)), _varContext t)
  where typesMatch t u = and $ (\f -> f t u) <$> [(==) `on` _varType, (==) `on` _varVisibility, (==) `on` (fmap (() <$) . _varInitialVal), (==) `on` _isImmutable]

addInheritedObjects :: CodeCollection -> Contract -> SolidEither Contract
addInheritedObjects cc c = do
  sd <- toUnionMaker' _storageDefs (M.filter ((/= Just Private) . _varVisibility) . _storageDefs) (matchType c) cc c
  ud <- toUnionMaker _userDefined cc c
  en <- toUnionMaker _enums cc c
  st <- toUnionMaker _structs cc c
  ev <- toUnionMaker _events cc c
  co <- toUnionMaker' _constants (M.filter ((/= Just Private) . _constVisibility) . _constants) match cc c
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
  sd <- toUnionMaker' _storageDefs _storageDefs (matchType c) cc c
  fu <- toUnionMaker' _functions (M.filter ((/= Just Private) . _funcVisibility) . _functions) match cc c
  co <- toUnionMaker _constants cc c
  pure $
    c
      { _functions = fu
      , _storageDefs = sd
      , _constants = co
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
  ancestors <- getAncestors cc c
  foldrM (M.mergeA miss miss onConflict) M.empty $ fSelf c : map fAncestors ancestors

-- | Every contract merged into c: each entry of getParentsAndUsings c followed by
-- its own ancestors, in first-visit order, which is also merge precedence. A
-- repeat visit adds nothing, so it is skipped rather than re-walked (which was
-- exponential in the depth of a diamond-shaped hierarchy).
getAncestors :: CodeCollection -> Contract -> SolidEither [Contract]
getAncestors cc c0 = reverse . snd <$> go (S.singleton $ c0 ^. contractName) (S.empty, []) c0
  where
    go onPath acc c = foldM (visit onPath) acc =<< getParentsAndUsings cc c
    visit onPath acc@(seen, out) p
      | n `S.member` onPath = Left (InternalError "inheritance cycle" (labelToString n), p ^. contractContext)
      | n `S.member` seen = Right acc
      | otherwise = go (S.insert n onPath) (S.insert n seen, p : out) p
      where n = p ^. contractName

resolveLabels :: CodeCollection -> CodeCollection
resolveLabels cc = cc {_contracts = fmap (resolveLabelsInContract cc) $ cc ^. contracts}

--TODO Figured out how to make UserDefined Work with this in the intented way
resolveLabelsInContract :: CodeCollection -> Contract -> Contract
resolveLabelsInContract cc c =
  c {_storageDefs = fmap (resolveLabelsInDef (cc ^. contracts) (c ^. userDefined) (c ^. enums) (c ^. structs)) $ c ^. storageDefs}

resolveLabelsInDef :: Map SolidString Contract -> Map SolidString SolidString -> Map SolidString a -> Map SolidString b -> VariableDecl -> VariableDecl
resolveLabelsInDef contractDefs userDefineDefs enumDefs structDefs x@VariableDecl {_varType = SVMType.UnknownLabel labelName} =
  case ( labelName `M.member` contractDefs,
         labelName `M.member` userDefineDefs,
         labelName `M.member` structDefs,
         labelName `M.member` enumDefs
       ) of
    (_, _, _, True) -> x {_varType = SVMType.Enum Nothing labelName Nothing}
    (_, _, True, _) -> x {_varType = SVMType.Struct Nothing labelName}
    (True, _, _, _) -> x {_varType = SVMType.Contract labelName}
    _ -> x {_varType = SVMType.UnknownLabel labelName}
-- _ -> error $ "unknown label in call to resolveLabelsInDef: " ++ labelName
resolveLabelsInDef _ _ _ _ x = x
