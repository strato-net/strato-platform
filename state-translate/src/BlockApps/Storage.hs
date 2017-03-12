
module BlockApps.Storage where

import Data.LargeWord

type Storage = Word256->Word256

data Position =
  Position {
    offset::Word256,
    byte::Int
    } 

positionAt::Word256->Position
positionAt p =
  Position {
    offset=p,
    byte=0
    } 
  
