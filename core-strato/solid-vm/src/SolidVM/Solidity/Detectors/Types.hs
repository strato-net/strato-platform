
module SolidVM.Solidity.Detectors.Types where

import Data.Source
import qualified Data.Text as T

import           CodeCollection

import           SolidVM.Solidity.Parse.Declarations (SourceUnit)

type ParserDetector = [SourceUnit] -> [SourceAnnotation T.Text]
type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
