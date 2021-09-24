module SolidVM.Solidity.Detectors 
  ( runDetectors
  ) where

import CodeCollection
import Data.Source
import Data.Text                          (Text)
import SolidVM.Solidity.Detectors.Trivial

detectors :: [Detector]
detectors = [trivialDetector]

runDetectors :: Functor f
             => (SourceMap -> f (CodeCollectionF SourcePosition))
             -> SourceMap
             -> f [SourceAnnotation Text]
runDetectors parse source = concat . (detectors <*>) . (:[]) <$> parse source