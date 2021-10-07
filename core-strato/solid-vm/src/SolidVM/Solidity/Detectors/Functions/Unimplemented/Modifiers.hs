{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.Detectors.Functions.Unimplemented.Modifiers
  ( detector
  ) where

import           CodeCollection
import qualified Data.Map.Strict as M
import           Data.Source
import           Data.Text       (Text)
import           SolidVM.Solidity.Xabi

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector CodeCollection{..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper Contract{..} = concat $ functionHelper <$> M.elems _functions

functionHelper :: Func -> [SourceAnnotation Text]
functionHelper Func{..} = case funcModifiers of
  Just (_:_) -> ["Custom modifiers are unsupported in SolidVM." <$ funcContext]
  _ -> []