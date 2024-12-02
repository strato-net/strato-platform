module SolidVM.Solidity.StaticAnalysis
  ( runDetectors,
  )
where

import Data.Bifoldable
import Data.Source
import Data.Text (Text)
import SolidVM.Model.CodeCollection
import SolidVM.Solidity.Parse.Declarations (SourceUnit)
import qualified SolidVM.Solidity.StaticAnalysis.Contracts.ParentConstructors as ParentConstructors
import qualified SolidVM.Solidity.StaticAnalysis.Expressions.BooleanLiterals as BooleanLiterals
import qualified SolidVM.Solidity.StaticAnalysis.Expressions.DivideBeforeMultiply as DivideBeforeMultiply
import qualified SolidVM.Solidity.StaticAnalysis.Functions.ConstantFunctions as ConstantFunctions
import qualified SolidVM.Solidity.StaticAnalysis.Pragmas.IncorrectSolidityVersion as IncorrectSolidityVersion
import qualified SolidVM.Solidity.StaticAnalysis.Statements.StateVariableShadowing as StateVariableShadowing
import qualified SolidVM.Solidity.StaticAnalysis.Statements.UninitializedLocalVariables as UninitializedLocalVariables
import qualified SolidVM.Solidity.StaticAnalysis.Statements.WriteAfterWrite as WriteAfterWrite
import qualified SolidVM.Solidity.StaticAnalysis.Trivial as Trivial
import qualified SolidVM.Solidity.StaticAnalysis.Typechecker as Typechecker
import SolidVM.Solidity.StaticAnalysis.Types
import qualified SolidVM.Solidity.StaticAnalysis.Variables.StateVariables as StateVariables

parserDetectors :: [ParserDetector]
parserDetectors =
  [ IncorrectSolidityVersion.detector
  ]

compilerWarningDetectors :: [CompilerDetector]
compilerWarningDetectors =
  [ Trivial.detector,
    ParentConstructors.detector,
    BooleanLiterals.detector,
    DivideBeforeMultiply.detector,
    StateVariableShadowing.detector,
    UninitializedLocalVariables.detector,
    WriteAfterWrite.detector,
    ConstantFunctions.detector,
    StateVariables.detector
  ]

compilerErrorDetectors :: [CompilerDetector]
compilerErrorDetectors =
  [ Typechecker.detector
  ]

runDetectors ::
  (Applicative (f a), Bifoldable f) =>
  (SourceMap -> f a [SourceUnit]) ->
  (SourceMap -> f a CodeCollection) ->
  (a -> [SourceAnnotation Text]) ->
  SourceMap ->
  [SourceAnnotation (WithSeverity Text)]
runDetectors parse compile handleErrors source =
  let parserAnnotations =
        map (withSeverity Warning)
          . concat
          . (parserDetectors <*>)
          . (: [])
          <$> parse source
      compilerErrors =
        map (withSeverity Error)
          . concat
          . (compilerErrorDetectors <*>)
          . (: [])
          <$> compile source
      compilerWarnings =
        map (withSeverity Warning)
          . concat
          . (compilerWarningDetectors <*>)
          . (: [])
          <$> compile source
   in bifoldMap (map (withSeverity Error) . handleErrors) id $
        (\p e w -> concat [p, e, w])
          <$> parserAnnotations
          <*> compilerErrors
          <*> compilerWarnings
