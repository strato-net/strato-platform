{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS -fno-warn-orphans      #-}

module SolidVM.Model.Delta
  ( Delta (..),
    toDelta,
    fromDelta,
    eqDelta,
    ValidatorDelta,
    getDeltasFromEvents,
    StakeDelta,
    getStakeDeltasFromEvents,
    applyStakeDelta
  )
where

import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.Validator
import Control.DeepSeq
import Data.Function (on)
import Data.List (find, foldl')
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import GHC.Generics
import SolidVM.Model.Event
import SolidVM.Model.Value (Value (..))
import Text.Read (readMaybe)

data Delta a b = Delta
  { _added   :: [a] -> [a]
  , _removed :: [b] -> [b]
  }
  deriving (Generic)

instance NFData (Delta a b) where
  rnf (Delta _ _) = ()

instance Semigroup (Delta a b) where
  (Delta a1 r1) <> (Delta a2 r2) = Delta (a1 . a2) (r1 . r2)

instance Monoid (Delta a b) where
  mempty = Delta id id
  mappend = (<>)

toDelta :: [a] -> [b] -> Delta a b
toDelta as bs = Delta (as++) (bs++)

fromDelta :: Delta a b -> ([a], [b])
fromDelta (Delta a b) = (a [], b [])

eqDelta :: (Eq a, Eq b) => Delta a b -> Delta a b -> Bool
eqDelta = (==) `on` fromDelta

type ValidatorDelta = Delta Validator Validator

getDeltasFromEvents :: [Event] -> ValidatorDelta
getDeltasFromEvents = foldr go mempty
  where go e ds@(Delta va vr) = case evContractAddress e of
          0x100 -> case evName e of -- MercataGovernance
            "ValidatorAdded" -> maybe ds (\v -> (Delta ((v:) . va) vr)) $ extractValidator e
            "ValidatorRemoved" -> maybe ds (\v -> (Delta va ((v:) . vr))) $ extractValidator e
            _ -> ds
          _ -> ds
        extractValidator e =
          case find (\arg -> eventArgName arg == "validator") (evArgs e) of
            Just arg -> case eventArgValue arg of
              SAddress a _ -> Just (Validator a)
              -- Fallback for legacy/JSON-derived events whose typed Value was
              -- lost on parse: re-parse the rendered string form.
              SNULL -> case reads (eventArgValueString arg) of
                [(addr, "")] -> Just (Validator addr)
                _ -> Nothing
              _ -> Nothing
            Nothing -> Nothing

-- | Absolute stake weights published by MercataGovernance during a block.
-- Within a block, the last write for a validator wins.
type StakeDelta = M.Map Validator Integer

-- | Stake weights come from the StratoStaking contract's ValidatorSynced
-- events: (operator, validator, registered, weight). registered=False always
-- carries weight 0, but we force it anyway so a deactivation can never leave a
-- stale weight. The watched address is the staking proxy from ethconf
-- ('stakingContractAddress'); 'Nothing' disables stake extraction.
getStakeDeltasFromEvents :: Maybe Address -> [Event] -> StakeDelta
getStakeDeltasFromEvents Nothing = const M.empty
getStakeDeltasFromEvents (Just stakingAddr) = foldl' go M.empty
  where go acc e
          | evContractAddress e == stakingAddr && evName e == "ValidatorSynced" =
              maybe acc (\(v, st) -> M.insert v st acc) $ do
                v <- Validator <$> arg "validator" e
                registered <- boolArg "registered" e
                st <- if registered then arg "weight" e else Just 0
                pure (v, st)
          | otherwise = acc
        arg :: Read a => String -> Event -> Maybe a
        arg name = (>>= readMaybe . eventArgValueString) . find ((== name) . eventArgName) . evArgs
        -- rendered Bool is "True"/"true" depending on the emitting path
        boolArg name e = case fmap eventArgValueString . find ((== name) . eventArgName) $ evArgs e of
          Just str | str `elem` ["True", "true"] -> Just True
                   | str `elem` ["False", "false"] -> Just False
          _ -> Nothing

-- | Apply a block's stake updates to the stake map in force for that block,
-- dropping validators that were removed in the same block.
applyStakeDelta :: [Validator] -> StakeDelta -> M.Map Validator Integer -> M.Map Validator Integer
applyStakeDelta removed updates current =
  M.union updates current `M.withoutKeys` S.fromList removed
