{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}

module ProcessComplexTypes where

import SolidityStateTypes
import qualified Data.Map as Map
import qualified Data.Vector as V

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.Layout

complexValueLabel :: ComplexStateVariable -> Map.Map StorageKey StorageValue -> ComplexStateValue
complexValueLabel var state = undefined


flattenRelevantValues = undefined

convertFlattenedValue = undefined


{-
  a complex type can span a single key value pairs. Fixed Size arrays can span single key value
  pairs, as can

-}
convertValueSingleKey :: StorageKey -> StorageValue -> SolidityBasicType -> ComplexStateValue
convertValueSingleKey key val = undefined

-- split array from lowest order for subsequent processing
splitVectorSolidity :: VariableLength -> Vector8 -> Either Vector8 [Vector8]
splitVectorSolidity len vec
  | len > (fromIntegral maxByteIndex `div` 2) = Left . fst $ vecPair
  | V.length vec < len = Right []
  | otherwise = appendEither (splitVectorSolidity len (snd vecPair)) (Right [fst vecPair])
  where
    vecPair :: (Vector8,Vector8)
    vecPair = V.splitAt len vec

    appendEither :: Either Vector8 [Vector8] -> Either Vector8 [Vector8] -> Either Vector8 [Vector8]
    appendEither (Right v1) (Right v2) = Right (v1++v2)

    appendEither _ _ = error "not implemented yet in appendEither"
