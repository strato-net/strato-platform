{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.StaticAnalysis.Pragmas.IncorrectSolidityVersion
  ( detector
  ) where

import           Data.Source
import           Data.Text                           (Text)
import qualified Data.Text                           as T
import           SolidVM.Solidity.StaticAnalysis.Types
import           SolidVM.Solidity.Parse.Declarations (SourceUnitF(..), SourceUnit)

-- type ParserDetector = [SourceUnit] -> [SourceAnnotation T.Text]
detector :: ParserDetector
detector = concatMap detectOneUnit

detectOneUnit :: SourceUnit -> [SourceAnnotation Text]
detectOneUnit (Pragma _ "solidvm" "3.0") = []
detectOneUnit (Pragma _ "solidvm" "3.2") = []
detectOneUnit (Pragma a name ver) = [(const $ T.pack $ "Unsupported pragma: " <> name <> " " <> ver) <$> a]
detectOneUnit _ = []
