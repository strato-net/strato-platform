{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module SolidVM.Solidity.StaticAnalysis.Pragmas.IncorrectSolidityVersion
  ( detector,
  )
where

import Data.Maybe (catMaybes)
import Data.Source
import Data.Text (Text)
import qualified Data.Text as T
import SolidVM.Model.CodeCollection (invalidPragmasUsedBy)
import SolidVM.Solidity.Parse.Declarations (SourceUnit, SourceUnitF (..))
import SolidVM.Solidity.StaticAnalysis.Types

-- type ParserDetector = [SourceUnit] -> [SourceAnnotation T.Text]
detector :: ParserDetector
detector = map (uncurry toAnnotation)
         . invalidPragmasUsedBy snd
         . catMaybes
         . map filterPragmas

filterPragmas :: SourceUnit -> Maybe (SourceAnnotation (), (String, String))
filterPragmas (Pragma p a b) = Just (p,(a,b))
filterPragmas _              = Nothing

toAnnotation :: SourceAnnotation () -> (String, String) -> SourceAnnotation Text
toAnnotation a (name, ver) = (T.pack $ "Unsupported pragma: " <> name <> " " <> ver) <$ a