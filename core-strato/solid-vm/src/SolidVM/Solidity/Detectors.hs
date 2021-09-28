module SolidVM.Solidity.Detectors 
  ( runDetectors
  ) where

import CodeCollection
import Data.Source
import Data.Text                          (Text)
import qualified SolidVM.Solidity.Detectors.Trivial                          as Trivial
import qualified SolidVM.Solidity.Detectors.Functions.Unimplemented.Continue as Continue

detectors :: [Detector]
detectors = [ Trivial.detector
            , Continue.detector
            ]

runDetectors :: Functor f
             => (SourceMap -> f CodeCollection)
             -> SourceMap
             -> f [SourceAnnotation Text]
runDetectors parse source = concat . (detectors <*>) . (:[]) <$> parse source