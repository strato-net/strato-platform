
module TimeIt where

import Data.Time.Clock.POSIX

timeIt::IO a->IO a
timeIt f = do
  before <- getPOSIXTime
  ret <- f
  after <- getPOSIXTime
  print (after-before)
  return ret
