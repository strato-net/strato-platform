{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.Generation
  ( readValidatorsFromGenesisInfo,
  )
where

import Blockchain.Data.GenesisInfo
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Validator (Validator(..))
import qualified Data.Map.Strict as M
import Data.Maybe
import SolidVM.Model.Storable hiding (size)

readValidatorsFromGenesisInfo :: GenesisInfo -> [Validator]
readValidatorsFromGenesisInfo gi = catMaybes . flip map (genesisInfoAccountInfo gi) $ \case
  SolidVMContractWithStorage _ _ (SolidVMCode "MercataValidator" _) storage -> do
    let storageMap = M.fromList storage
    c <- M.lookup ".commonName" storageMap
    case c of
      BAccount c' -> do
        pure $ (Validator $ _namedAccountAddress c')
      _ -> Nothing
  _ -> Nothing

