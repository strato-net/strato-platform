-- |
-- Module: Fast.Parser
-- Description: Entry points of the token parser: run a rule over the tokens
-- of a text. Builds the same AST as the parsec grammar in
-- "SolidVM.Solidity.Parse.File", which the VM still uses.
module SolidVM.Solidity.Parse.Fast.Parser
  ( parseSolidity,
    parseExpression,
    parseArg,
    parseExternalCallArgs,
    runRule,
  )
where

import Data.Text (Text)
import qualified Data.Text as T
import SolidVM.Model.CodeCollection.Statement (Expression)
import SolidVM.Model.SolidString (SolidString)
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Parse.Fast.Expression
import SolidVM.Solidity.Parse.Fast.File
import SolidVM.Solidity.Parse.File (File)
import SolidVM.Solidity.Parse.Fast.Lexer
import SolidVM.Solidity.Parse.Fast.Monad
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.Parse.Fast.Types
import Data.Maybe (fromMaybe)
import Text.Parsec.Error (Message (..), ParseError, addErrorMessage, newErrorMessage)
import Text.Parsec.Pos (newPos)

-- | A whole source file.
parseSolidity :: ParserState -> String -> Text -> Either ParseError File
parseSolidity = runRule solidityFile

-- | An expression on its own, as the debugger evaluates.
parseExpression :: ParserState -> String -> Text -> Either ParseError Expression
parseExpression = runRule (expression <* eof)

-- | A transaction argument.
parseArg :: ParserState -> String -> Text -> Either ParseError Expression
parseArg = runRule (literal <* eof)

-- | @name(type, ...)@ naming an external call's target; the name defaults to
-- @fallback@.
parseExternalCallArgs :: ParserState -> String -> Text -> Either ParseError (SolidString, [SVMType.Type])
parseExternalCallArgs = runRule ((,) <$> (fromMaybe "fallback" <$> optionalIdentifier) <*> parens (commaSep simpleType))

-- | Runs a rule over the tokens of a text. On failure the error is at the
-- furthest token any rule failed at: what stood there, what could have, or
-- why it was rejected.
runRule :: P a -> ParserState -> String -> Text -> Either ParseError a
runRule rule st name src = case runP rule (St toks src name st) of
  Right (a, _) -> Right a
  Left (i, err) ->
    let t = tokenAt toks i
        pos = newPos name (tLine t) (tCol t)
        unexpected = case tKind t of
          TEOF -> SysUnExpect ""
          _ -> SysUnExpect (show (T.unpack (tText t)))
     in Left $ case (tKind t, err) of
          (TError, _) -> newErrorMessage (Message (tStr t)) pos
          (_, Because why) -> newErrorMessage (Message why) pos
          (_, Expecting es) -> foldr (addErrorMessage . Expect . T.unpack) (newErrorMessage unexpected pos) es
  where
    toks = tokenize src
