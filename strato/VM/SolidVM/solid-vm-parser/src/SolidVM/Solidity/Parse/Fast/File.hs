{-# LANGUAGE OverloadedStrings #-}

-- |
-- Module: Fast.File
-- Description: A Solidity source file: pragmas, imports, aliases and the
-- units declared at file level, over tokens
module SolidVM.Solidity.Parse.Fast.File
  ( solidityFile,
  )
where

import qualified Data.Map as M
import qualified Data.Text as T
import SolidVM.Model.CodeCollection.Import
import qualified SolidVM.Model.CodeCollection as SolidVM
import SolidVM.Solidity.Parse.Declarations (Declaration (..), SourceUnitF (..), SourceUnit)
import SolidVM.Solidity.Parse.Fast.Declarations
import SolidVM.Solidity.Parse.Fast.Expression
import SolidVM.Solidity.Parse.File (File (..))
import SolidVM.Solidity.Parse.Fast.Lexer
import SolidVM.Solidity.Parse.Fast.Monad
import SolidVM.Solidity.Parse.ParserTypes

solidityFile :: P File
solidityFile = File <$> manyTill sourceUnit eof

sourceUnit :: P SourceUnit
sourceUnit = sourceUnit' <?> "pragma, import or declaration"

sourceUnit' :: P SourceUnit
sourceUnit' = do
  t <- peek
  case tText t of
    "pragma" -> pragma
    "import" -> fileImport
    "type" -> alias
    "using" -> FLUsing <$> usingDeclaration True
    "function" -> freeFunction
    "struct" -> do
      ~(a, (name, fields)) <- withPosition structFields
      pure (FLStruct (T.pack name) (mkStruct a fields))
    "enum" -> do
      ~(a, (name, fields)) <- withPosition enumFields
      pure (FLEnum (T.pack name) (mkEnum a fields))
    "error" -> do
      ~(a, (name, args)) <- withPosition errorArgs
      semi
      pure (FLError (T.pack name) (mkError a args))
    _ -> solidityContract <|> constant

-- | @pragma name anything;@
pragma :: P SourceUnit
pragma = do
  ~(a, (name, rest)) <- withPosition $ do
    reserved "pragma"
    name <- identifier
    rest <- rawUntilSemi
    pure (name, rest)
  pure (Pragma a name rest)

-- | @type Name is anything;@
alias :: P SourceUnit
alias = do
  ~(a, (name, rest)) <- withPosition $ do
    reserved "type"
    name <- identifier
    reserved "is"
    rest <- rawUntilSemi
    pure (name, rest)
  modifySt (\s -> s {userDefinedTypes = M.insert name rest (userDefinedTypes s)})
  pure (Alias a name rest)

-- | The source text up to the next @;@, trimmed; consumes the @;@ too.
rawUntilSemi :: P String
rawUntilSemi = do
  from <- tByte <$> peek
  to <- semiByte 0
  raw <- sourceSlice from to
  skipToByte to
  semi
  pure (T.unpack (T.strip raw))
  where
    semiByte n = do
      t <- peekAt n
      case tKind t of
        TPunct | tText t == ";" -> pure (tByte t)
        TEOF -> tByte t <$ (skipToByte (tByte t) *> semi)
        _ -> semiByte (n + 1)

-- | @import "path";@, @import "path" as "name";@ or
-- @import {a, b as c} from "path";@
fileImport :: P SourceUnit
fileImport = do
  ~(a, imp) <- withPosition $ do
    reserved "import"
    braced <|> plain
  semi
  pure (Import a imp)
  where
    plain = do
      ~(a, (e, qualifier)) <- withPosition ((,) <$> expression <*> optionMaybe (reserved "as" *> stringLiteral))
      pure (maybe (Simple e a) (\q -> Qualified e (T.pack q) a) qualifier)
    braced = do
      ~(a, (items, e)) <- withPosition ((,) <$> braces (commaSep1 item) <*> (reserved "from" *> expression))
      pure (Braced items e a)
    item = do
      ~(a, (name, as)) <- withPosition ((,) <$> identifier <*> optionMaybe (reserved "as" *> identifier))
      pure (maybe (Named (T.pack name) a) (\n -> Aliased (T.pack name) (T.pack n) a) as)

-- | A free function is always internal.
freeFunction :: P SourceUnit
freeFunction = do
  (name, decl) <- functionDeclaration True
  case decl of
    FuncDeclaration f | SolidVM._funcVisibility f == Just SolidVM.Internal -> pure (FLFunc name f)
    _ -> failWith ("free function " ++ name ++ " is internal; it cannot be given another visibility")

-- | Only constants may be declared at file level.
constant :: P SourceUnit
constant = do
  (name, decl) <- stateVariable
  case decl of
    ConstantDeclaration c -> pure (FLConstant (T.pack name) c)
    _ -> failWith ("only constants can be declared at file level; " ++ name ++ " is a variable")
