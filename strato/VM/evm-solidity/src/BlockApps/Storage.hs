{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE RecordWildCards #-}

module BlockApps.Storage where

import Blockchain.Strato.Model.ExtendedWord
import Control.DeepSeq
import GHC.Generics

type Storage = Word256 -> Word256

type Cache = Word256 -> Maybe Word256

data Position = Position
  { offset :: Word256,
    byte :: Int
  }
  deriving (Show, Generic, NFData)

positionAt :: Word256 -> Position
positionAt p = Position p 0

addBytes :: Position -> Word256 -> Position
addBytes position@Position {..} v =
  let (extraOffset, byte') = (fromIntegral byte + v) `quotRem` 32
   in position {offset = offset + extraOffset, byte = fromIntegral byte'}

addOffset :: Position -> Word256 -> Position
addOffset position@Position {..} v = position {offset = offset + v}

alignedByte :: Position -> Word256
alignedByte Position {byte = 0, offset = o} = o
alignedByte Position {offset = o} = o + 1
