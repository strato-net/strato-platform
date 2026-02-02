{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS -fno-warn-orphans      #-}

module Blockchain.Strato.Model.Delta
  ( Delta (..),
    toDelta,
    fromDelta,
    eqDelta,
    ValidatorDelta,
    getDeltasFromEvents
  )
where

import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.Validator
import Control.DeepSeq
import Data.Function (on)
import Data.List (find)
import GHC.Generics

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
            "ValidatorAdded" -> maybe ds (\v -> (Delta ((v:) . va) vr)) $ extractCommonName e
            "ValidatorRemoved" -> maybe ds (\v -> (Delta va ((v:) . vr))) $ extractCommonName e
            _ -> ds
          _ -> ds
        extractCommonName = fmap (Validator . read . second) . find (\(x, _, _) -> x == "validator") . evArgs
        second (_, y, _)  = y
