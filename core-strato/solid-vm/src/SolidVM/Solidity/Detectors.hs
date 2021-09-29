module SolidVM.Solidity.Detectors 
  ( runDetectors
  ) where

import           CodeCollection
import           Data.Source
import           Data.Text                                                         (Text)
import           SolidVM.Solidity.Parse.Declarations                               (SourceUnit)
import qualified SolidVM.Solidity.Detectors.Trivial                                as Trivial
import qualified SolidVM.Solidity.Detectors.Expressions.DivideBeforeMultiply       as DivideBeforeMultiply
import qualified SolidVM.Solidity.Detectors.Pragmas.IncorrectSolidityVersion       as IncorrectSolidityVersion
import qualified SolidVM.Solidity.Detectors.Functions.Unimplemented.Continue       as Continue
import qualified SolidVM.Solidity.Detectors.Statements.StateVariableShadowing      as StateVariableShadowing
import qualified SolidVM.Solidity.Detectors.Statements.UninitializedLocalVariables as UninitializedLocalVariables

parserDetectors :: [ParserDetector]
parserDetectors = [ IncorrectSolidityVersion.detector
                  ]

compilerDetectors :: [CompilerDetector]
compilerDetectors = [ Trivial.detector
                    , Continue.detector
                    , DivideBeforeMultiply.detector
                    , StateVariableShadowing.detector
                    , UninitializedLocalVariables.detector
                    ]

runDetectors :: Applicative f
             => (SourceMap -> f [SourceUnit])
             -> (SourceMap -> f CodeCollection)
             -> SourceMap
             -> f [SourceAnnotation Text]
runDetectors parse compile source =
  let parserAnnotations = concat . (parserDetectors <*>) . (:[]) <$> parse source
      compilerAnnotations = concat . (compilerDetectors <*>) . (:[]) <$> compile source
   in (++) <$> parserAnnotations <*> compilerAnnotations