{-# LANGUAGE OverloadedStrings #-}

-- | Regression tests for the unconditional parser-side fixes from the
-- 2026 Consensys Diligence audit. These exercise behaviours that should
-- be active on every network/block (no fork gate) — see
-- 'Blockchain.VM.ForkGate' for the gated subset.
module AuditFixSpec (spec) where

import Data.Either (isLeft)
import SolidVM.Solidity.Parse.Declarations (SourceUnit)
import qualified SolidVM.Solidity.Parse.Lexer as Lexer
import SolidVM.Solidity.Parse.ParserTypes
import qualified SolidVM.Solidity.Parse.Pragmas as Pragmas
import qualified SolidVM.Solidity.Parse.Statement as Stmt
import Test.Hspec
import Text.Parsec

runStringLiteral :: String -> Either ParseError String
runStringLiteral = runParser (Lexer.stringLiteral <* eof) initialParserState ""

runPragma :: String -> Either ParseError SourceUnit
runPragma = runParser Pragmas.solidityPragma initialParserState ""

runBoundedNoneOf :: Int -> String -> String -> Either ParseError String
runBoundedNoneOf cap forbidden =
  runParser (Lexer.boundedNoneOf cap forbidden <* eof) initialParserState ""

-- 'boundedManyTillString' consumes its terminator on success, so we
-- only follow it with 'eof' (no second 'string end').
runBoundedManyTill :: Int -> String -> String -> Either ParseError String
runBoundedManyTill cap end =
  runParser (Stmt.boundedManyTillString cap end <* eof) initialParserState ""

spec :: Spec
spec = do
  -- Audit finding 24: malformed escape sequences must reject via Parsec
  -- 'fail' (caller gets a Left ParseError) rather than crash the parser
  -- thread with a bare 'error'. The pre-fix code threw on inputs whose
  -- hex/unicode escape sequences could not be decoded.
  describe "Audit finding 24: Lexer escape-sequence handling" $ do
    it "well-formed \\xNN escape parses successfully" $ do
      runStringLiteral "\"\\x41\"" `shouldBe` Right "A"

    it "well-formed \\uNNNN escape parses successfully" $ do
      runStringLiteral "\"\\u0041\"" `shouldBe` Right "A"

    it "non-hex digit in \\xNN rejects without crashing" $ do
      runStringLiteral "\"\\xZZ\"" `shouldSatisfy` isLeft

    it "non-hex digit in \\uNNNN rejects without crashing" $ do
      runStringLiteral "\"\\uZZZZ\"" `shouldSatisfy` isLeft

    it "unterminated escape (\\) rejects without crashing" $ do
      runStringLiteral "\"\\" `shouldSatisfy` isLeft

  -- Audit finding 30: pragma/alias/using were using @many (noneOf ";")@
  -- which allocates an unbounded char list when the source omits its
  -- terminating semicolon. The fix wraps these with a 4096/1024 char
  -- 'boundedNoneOf' that fails fast.
  describe "Audit finding 30: bounded noneOf parsers" $ do
    -- 'boundedNoneOf cap' accepts up to cap-1 chars before insisting on
    -- the delimiter (cap=N caps the recursion at depth N which fires
    -- the "input too long" path on consumed-input boundary). The
    -- exact off-by-one doesn't matter at production caps (4096/1024)
    -- — what matters is it eventually fails.
    it "boundedNoneOf 8 accepts inputs strictly under the cap" $ do
      runBoundedNoneOf 8 ";" "abcdefg" `shouldBe` Right "abcdefg"

    it "boundedNoneOf 8 rejects inputs at or past the cap" $ do
      runBoundedNoneOf 8 ";" (replicate 9 'a') `shouldSatisfy` isLeft

    it "well-formed pragma still parses" $ do
      runPragma "pragma solidvm 12.4;" `shouldSatisfy` isRightEither

    it "pragma with 5000-byte runaway body rejects without OOM" $ do
      let runaway = "pragma solidvm " ++ replicate 5000 'x'
      runPragma runaway `shouldSatisfy` isLeft

    it "alias-style line with 2000-byte body rejects without OOM" $ do
      -- Audit finding 30 also applies to using/alias — the limit there
      -- is 1024 chars. We use boundedNoneOf directly so we don't have
      -- to spin up the full alias parser fixture.
      runBoundedNoneOf 1024 ";" (replicate 2000 'a') `shouldSatisfy` isLeft

  -- Audit finding 31: parseCreateContractSrc / parseCreateConstructArgs
  -- used @manyTill anyChar (try (string s))@ which allocates the entire
  -- (un-terminated) input. The fix caps the embedded src/args at
  -- 'maxEmbeddedContractSrcChars' (512KB).
  describe "Audit finding 31: bounded manyTill embedded contract source" $ do
    it "embedded source under the cap parses fully" $ do
      let body = replicate 32 'x'
      runBoundedManyTill (512 * 1024) "\"," (body ++ "\",") `shouldBe` Right body

    it "embedded source over the 512KB cap rejects without OOM" $ do
      -- Build an unterminated (no closing delimiter) 600KB input.
      let body = replicate (600 * 1024) 'x'
      runBoundedManyTill (512 * 1024) "\"," body `shouldSatisfy` isLeft
  where
    isRightEither :: Either a b -> Bool
    isRightEither (Right _) = True
    isRightEither _         = False
