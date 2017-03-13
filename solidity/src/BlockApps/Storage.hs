
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
addBytes position 32 = position{offset=offset position + 1} 
addBytes position v | v+byte position < 32 = position{byte=byte position+v} 
addBytes x y = error $ "addBytes called for value not defined yet: " ++ show x ++ ", " ++ show y
