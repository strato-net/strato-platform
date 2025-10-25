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
import Blockchain.Strato.Model.Validator (Validator(..))
import qualified Data.Map.Strict as M
import Data.Maybe
import Data.String
import SolidVM.Model.Storable hiding (size)

readValidatorsFromGenesisInfo :: GenesisInfo -> [Validator]
readValidatorsFromGenesisInfo gi = concat . flip map (genesisInfoAccountInfo gi) $ \case
  SolidVMContractWithStorage 0x100 _ _ storage ->
    let storageMap = M.fromList storage
     in case M.lookup ".validators.length" storageMap of
          Just (BInteger l) -> mapMaybe (\i -> case M.lookup (fromString $ ".validators[" ++ show i ++ "]") storageMap of
            Just (BAddress a) -> Just $ Validator a
            _ -> Nothing) [0..l-1]
          _ -> []
  _ -> []
