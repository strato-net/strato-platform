{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Components.ValidatorsCard where

import Reflex.Dom.Core
import qualified Data.Text as T
import qualified Types.State as TS

-- Configuration for the validators card
data ValidatorsCardConfig = ValidatorsCardConfig
  { vcValidators :: [TS.Validator]  -- List of validators
  , vcTotalStake :: Double      -- Total stake
  }

-- Main validators card widget
validatorsCard :: MonadWidget t m => ValidatorsCardConfig -> m ()
validatorsCard config = do
  elClass "div" "validators-card" $ do
    -- Header
    elClass "div" "validators-header" $ do
      el "h3" $ text "Validators"
      elClass "div" "total-stake" $ do
        text "Total Stake: "
        text $ T.pack $ show $ vcTotalStake config

    -- Validators table
    elClass "div" "validators-table" $ do
      -- Table header
      elClass "div" "table-header" $ do
        elClass "div" "header-cell" $ text "Validator"
        elClass "div" "header-cell" $ text "Stake"
        elClass "div" "header-cell" $ text "Status"

      -- Table rows
      let totalStake = vcTotalStake config
      mapM_ (validatorRow totalStake) (vcValidators config)

-- Individual validator row
validatorRow :: (MonadWidget t m) => Double -> TS.Validator -> m ()
validatorRow totalStake validator = do
  elClass "div" "table-row" $ do
    -- Validator name/id
    elClass "div" "cell" $ do
      elClass "div" "validator-name" $ text (TS.validatorAddress validator)
      elClass "div" "validator-id" $ text (TS.validatorAddress validator)

    -- Stake amount and percentage
    elClass "div" "cell" $ do
      let stakePercent = (TS.validatorStake validator / totalStake) * 100
      elClass "div" "stake-amount" $ text $ T.pack $ show $ TS.validatorStake validator
      elClass "div" "stake-percent" $ text $ T.pack $ show (round stakePercent :: Integer) <> "%"

    -- Status
    elClass "div" "cell" $ do
      let statusClassName = "status-" <> statusClass (TS.validatorStatus validator)
      elClass "div" statusClassName $ text $ statusText (TS.validatorStatus validator)

-- Helper function to get status class name
statusClass :: TS.ValidatorStatus -> T.Text
statusClass status = case status of
  TS.ValidatorActive -> "active"
  TS.ValidatorInactive -> "inactive"
  TS.ValidatorSlashed -> "slashed"

-- Helper function to get status display text
statusText :: TS.ValidatorStatus -> T.Text
statusText status = case status of
  TS.ValidatorActive -> "Active"
  TS.ValidatorInactive -> "Inactive"
  TS.ValidatorSlashed -> "Slashed" 