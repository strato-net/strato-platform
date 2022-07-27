{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.StaticAnalysis.Functions.Unimplemented.Modifiers
  ( detector
  ) where

import qualified Data.Map.Strict as M
import           Data.Maybe      (maybeToList)
import           Data.Source
import           Data.Text       (Text)
import           SolidVM.Model.CodeCollection
import           SolidVM.Solidity.StaticAnalysis.Types

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector CodeCollection{..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper Contract{..} = concat $ functionHelper <$> maybeToList _constructor ++ M.elems _functions

functionHelper :: Func -> [SourceAnnotation Text]
functionHelper Func{..} = case _funcModifiers of
  Just (_:_) -> ["Custom modifiers are unsupported in SolidVM." <$ _funcContext]
  _ -> []
