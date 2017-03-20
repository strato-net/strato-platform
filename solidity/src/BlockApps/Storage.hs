{-#
  LANGUAGE
    RecordWildCards
#-}
module BlockApps.Storage where

import Data.LargeWord

type Storage = Word256->Word256

data Position =
  Position {
    offset::Word256,
    byte::Int
    } deriving (Show)

positionAt::Word256->Position
positionAt p =
  Position {
    offset=p,
    byte=0
    }

addBytes::Position->Int->Position
addBytes position@Position{..} v =
  let
    (extraOffset, byte') = (byte+v) `quotRem` 32
  in
   position{offset=offset + fromIntegral extraOffset, byte=byte'}

alignedByte::Position->Word256
alignedByte Position{byte=0, offset=o} = o
alignedByte Position{offset=o} = o+1
