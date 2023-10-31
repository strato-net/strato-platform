module SolidVM.Solidity.StaticAnalysis.Types where

import Data.Source
import qualified Data.Text as T
import SolidVM.Model.CodeCollection
import SolidVM.Solidity.Parse.Declarations (SourceUnit)

type ParserDetector = [SourceUnit] -> [SourceAnnotation T.Text]

type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
