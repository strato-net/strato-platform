{-# LANGUAGE DataKinds, GADTs, KindSignatures, TypeOperators, RankNTypes, ScopedTypeVariables,
             LambdaCase, OverloadedStrings, ExistentialQuantification, TupleSections, NamedFieldPuns, CPP, TemplateHaskell, TypeApplications #-}
-- SolidVM source -> typed Haskell actions.  Typecheck and compile in one pass over the
-- existing parser's CodeCollection.  Strict: no implicit coercions; anything the typed
-- model cannot express is reported as an Err, never approximated.
-- Contract-to-address is a selected compatibility exception (see README.md).
module SolidVM.Source where

import Control.Exception (throwIO)
import Control.Lens ((^.), (&), (.~))
import Control.Monad
import Control.Monad.Reader
import Data.Bifunctor (first)
import Data.Decimal
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.IORef
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Sequence as Seq
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import Data.Type.Equality ((:~:) (Refl))
import Blockchain.Strato.Model.Address (Address (..))
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import qualified Data.Source.Annotation as SA
import qualified Data.Source.Position as SP
import SolidVM.Model.CodeCollection hiding (DelegateCall, RawCall, Internal)
import qualified SolidVM.Model.CodeCollection.Statement as S
import SolidVM.Model.Storable (BasicValue (BDefault), StoragePath (..), StoragePathPiece (..))
import qualified SolidVM.Model.Type as Ty
import SolidVM.Core hiding (Fun(..))
import SolidVM.SourceCode
import qualified SolidVM.Quotation.Inspection as Quotation
import qualified SolidVM.Builtins as Builtins
import qualified Language.Haskell.TH as TH
import qualified Language.Haskell.Exts as Haskell
import qualified Language.Haskell.TH.Syntax as TH (NameSpace(..))
import qualified Control.Monad.State.Strict as State
import Data.Data (Data, gmapT, gmapQ, gmapM)
import qualified Data.Data as Data
import Data.List (nub, sort)
import Data.Char (isAlphaNum, toLower)
import System.Mem.StableName
import Control.Exception (evaluate)


#include "Compiler.inc"

instance ToSource ErrKind where
  toSource kind = TH.ConE (TH.mkName ("SolidVM.Compile." ++ show kind))
instance ToSource Err where
  toSource (Err k m f l) = TH.AppE (TH.AppE (TH.AppE (TH.AppE (TH.ConE (TH.mkName "SolidVM.Compile.Err")) (toSource k)) (toSource m)) (toSource f)) (toSource l)

-- Render complete closure definitions, including getters and constructor stages.
-- Internal links refer to typed top-level definitions rather than expanding
-- recursive functions forever.
renderCollection :: CodeCollection -> IO (Either [(T.Text, Err)] T.Text)
renderCollection = renderSelected Nothing

renderContract :: T.Text -> CodeCollection -> IO (Either [(T.Text, Err)] T.Text)
renderContract name cc
  | M.member name (cc ^. contracts) = renderSelected (Just name) cc
  | otherwise = pure (Left [(name, Err Unknown "contract not found" "" Nothing)])

renderSelected :: Maybe T.Text -> CodeCollection -> IO (Either [(T.Text, Err)] T.Text)
renderSelected selection cc = let collection = compileCollection cc in case collectionErrors collection of
  failures@(_ : _) -> pure (Left failures)
  [] -> Right <$> renderAccepted selection cc collection

renderAccepted :: Maybe T.Text -> CodeCollection -> CompiledCollection -> IO T.Text
renderAccepted selection cc collection = do
  let contracts' = M.elems (colContracts collection)
      entries = [f | c <- contracts', Right f <- M.elems (ccFuns c)]
        ++ [f | c <- contracts', Just (Right f) <- [ccConstructor c]]
        ++ [f | c <- contracts', Right f <- [ccInitializers c]]
        ++ [f | c <- contracts', Right f <- M.elems (ccParentArguments c)]
      extra = [f | contract <- M.elems (cc ^. contracts),
        (n, declaration) <- M.toList (cc ^. flFuncs),
        Right f <- [compileFunction (mkCtx cc contract) n declaration]]
        ++ [f | contract <- M.elems (cc ^. contracts),
          (n, declaration) <- M.toList (contract ^. functions),
          variant <- declaration : (declaration ^. funcOverload),
          isJust (variant ^. funcContents),
          Right f <- [compileFunction (mkCtx cc contract) ("super." <> n) variant]]
        ++ [f | contract <- M.elems (cc ^. contracts), Just declaration <- [contract ^. constructor],
          Right f <- [compileFunction (mkCtx cc contract) "constructor" declaration]]
      registry = M.fromList [(functionName name, f) | f@(Fun _ _ body) <- entries ++ extra, Just name <- [codeName body]]
      roots = [name | Fun _ _ body <- entries, Just name <- [codeName body],
        maybe True (\contract -> (contract <> ".") `T.isPrefixOf` name) selection]
  lowered <- snd <$> State.execStateT (mapM_ (emit registry . functionName) roots) ([], [])
  let functionNames = [(name, readableName original) |
        TH.ValD (TH.VarP name) _ _ <- lowered,
        Just (Fun _ _ body) <- [M.lookup name registry], Just original <- [codeName body]]
      shortFunctions = uniqueNames functionNames
      renamed = replaceNames (\n -> fromMaybe n (lookup n shortFunctions)) lowered
      (importLines, declarations) = shortenImports renamed
  pure $ T.pack $ unlines
    (["{-# LANGUAGE DataKinds, GADTs, LambdaCase, OverloadedStrings, TypeOperators, TupleSections, ExplicitNamespaces, PatternSynonyms #-}",
      "module CompiledContracts where", ""]
      ++ importLines
      ++ ["", renderDeclarations declarations])
  where
    emit :: M.Map TH.Name Fun -> TH.Name -> State.StateT ([TH.Name], [TH.Dec]) IO ()
    emit registry name = do
      (seen, _) <- State.get
      unless (name `elem` seen) $ case M.lookup name registry of
        Nothing -> error ("missing compiled function: " ++ TH.nameBase name)
        Just function -> do
          State.modify (\(names, declarations) -> (name : names, declarations))
          declarations <- liftIO $ mapM flattenDeclaration (functionDeclarations function)
          mapM_ (emit registry) (nub [n | n <- referencedNames declarations, "fn_" `T.isPrefixOf` T.pack (TH.nameBase n)])
          State.modify (\(names, accumulated) -> (names, accumulated ++ declarations))
    referencedNames :: Data a => a -> [TH.Name]
    referencedNames x = case Data.cast x of
      Just (TH.VarE name) -> [name]
      _ -> concat (gmapQ referencedNames x)
renderDeclarations :: [TH.Dec] -> String
renderDeclarations declarations =
  let source = TH.pprint declarations
      mode = Haskell.defaultParseMode { Haskell.fixities = Nothing, Haskell.extensions = map Haskell.EnableExtension
        [Haskell.DataKinds, Haskell.GADTs, Haskell.LambdaCase, Haskell.OverloadedStrings,
         Haskell.TypeOperators, Haskell.TupleSections, Haskell.ExplicitNamespaces, Haskell.PatternSynonyms] }
  in case Haskell.parseModuleWithMode mode source of
    Haskell.ParseOk parsed -> Haskell.prettyPrintWithMode Haskell.defaultMode { Haskell.spacing = False } parsed
    Haskell.ParseFailed _ _ -> source

-- Fingerprints remain internal link identities. Printed names retain the original
-- contract/function spelling, with numeric suffixes only for conflicting variants.
readableName :: T.Text -> String
readableName original = case map clean (T.unpack (T.takeWhile (/= '/') (T.takeWhile (/= '#') original))) of
  [] -> "contractFunction"
  initial : rest -> toLower initial : rest
  where clean c | isAlphaNum c || c == '_' = c
                | otherwise = '_'

uniqueNames :: [(TH.Name, String)] -> [(TH.Name, TH.Name)]
uniqueNames candidates = snd $ foldl assign ([], []) candidates
  where
    reserved = map snd candidates
    assign (used, names) (original, base) =
      let choose index =
            let candidate = base ++ if index == 1 then "" else "_" ++ show index
             in if candidate `elem` used || (index /= 1 && candidate `elem` reserved)
                  then choose (index + 1) else candidate
          short = choose (1 :: Int)
       in (short : used, names ++ [(original, TH.mkName short)])

replaceNames :: Data a => (TH.Name -> TH.Name) -> a -> a
replaceNames rename x = case Data.cast x of
  Just name -> fromMaybe x (Data.cast (rename name))
  Nothing -> gmapT (replaceNames rename) x

-- Imports are derived from the names actually used, including constructor/type
-- namespaces. Conflicting names retain a short module qualifier.
shortenImports :: [TH.Dec] -> ([String], [TH.Dec])
shortenImports declarations = (importLines, replaceNames shorten declarations)
  where
    references = sort (nub (collectReferences declarations))
    owners = M.fromListWith (++) [(base, [modul]) | (modul, base, _) <- references]
    localNames = boundNames declarations
    qualified base = length (nub (M.findWithDefault [] base owners)) > 1 || base `elem` localNames
    modules = sort (nub [modul | (modul, _, _) <- references])
    aliases = zip modules (map (TH.nameBase . snd) (uniqueNames
      [(TH.mkName ("module_" ++ show index), moduleAlias modul) | (index, modul) <- zip [1 :: Int ..] modules]))
    moduleAlias "Control.Monad.IO.Class" = "MonadIO"
    moduleAlias "Control.Monad.Reader.Class" = "Reader"
    moduleAlias modul = case reverse (T.splitOn "." (T.pack modul)) of
      suffix : _ -> T.unpack suffix
      [] -> "Module"
    alias modul = fromMaybe modul (lookup modul aliases)
    importLines = concatMap importModule modules
    importModule modul =
      let plain = [item base space | (m, base, space) <- references, m == modul, not (qualified base)]
          qualifiedNames = [item base space | (m, base, space) <- references, m == modul, qualified base]
          line prefix names = [prefix ++ " (" ++ comma (nub names) ++ ")" | not (null names)]
       in line ("import " ++ modul) plain
          ++ line ("import qualified " ++ modul ++ " as " ++ alias modul) qualifiedNames
    item base space = (if space == TH.DataName then "pattern " else if space == TH.TcClsName then "type " else "")
      ++ if all (\c -> isAlphaNum c || c == '_' || c == '\'') base then base else "(" ++ base ++ ")"
    comma = T.unpack . T.intercalate ", " . map T.pack
    shorten name = case TH.nameModule name of
      Nothing -> name
      Just original ->
        let modul = publicModule original (TH.nameBase name)
            base = TH.nameBase name
         in TH.mkName $ if builtin name then base else
              (if qualified base then alias modul ++ "." else "") ++ base
    builtin name = TH.nameBase name `elem` ["[]", ":"] || TH.nameModule name == Just "GHC.Tuple.Prim"
    reference name space = case TH.nameModule name of
      Just modul | not (builtin name) -> [(publicModule modul (TH.nameBase name), TH.nameBase name, space)]
      _ -> []
    collectReferences :: Data a => a -> [(String, String, TH.NameSpace)]
    collectReferences x = specific ++ concat (gmapQ collectReferences x)
      where
        specific = case Data.cast x of
          Just (TH.VarE name) -> reference name TH.VarName
          Just (TH.ConE name) -> reference name TH.DataName
          _ -> case Data.cast x of
            Just (TH.ConT name) -> reference name TH.TcClsName
            _ -> case Data.cast x of
              Just (TH.ConP name _ _) -> reference name TH.DataName
              _ -> case Data.cast x of
                Just name -> maybe [] (reference name) (TH.nameSpace name)
                Nothing -> []
    boundNames :: Data a => a -> [String]
    boundNames x = case Data.cast x of
      Just (TH.VarP name) -> [TH.nameBase name]
      Just (TH.AsP name _) -> TH.nameBase name : concat (gmapQ boundNames x)
      _ -> case Data.cast x of
        Just (TH.FunD name _) -> TH.nameBase name : concat (gmapQ boundNames x)
        _ -> concat (gmapQ boundNames x)

publicModule :: String -> String -> String
publicModule modul name = case modul of
  "SolidVM.Source" -> "SolidVM.Compile"
  "Data.ByteString.Internal.Type" -> "Data.ByteString"
  "Data.Text.Internal" -> "Data.Text"
  "Data.Sequence.Internal" -> "Data.Sequence"
  "GHC.IORef" -> "Data.IORef"
  "GHC.IO" | name /= "IO" -> "Control.Exception"
  "GHC.Base" | name `elem` ["when", "unless", "join", "ap", "liftM"] -> "Control.Monad"
  _ | modul `elem` ["GHC.Base", "GHC.Classes", "GHC.Types", "GHC.Maybe", "GHC.Num", "GHC.Num.Integer", "GHC.Real", "GHC.Show", "GHC.List", "GHC.IO"] -> "Prelude"
  _ -> modul

-- Captures are compile-time values and closed action expressions. Float their
-- bindings into one let per function; retaining their dependency names avoids
-- duplicating closures whenever the original compiler reused one.
flattenDeclaration :: TH.Dec -> IO TH.Dec
flattenDeclaration (TH.ValD pattern (TH.NormalB rootExpression) declarations) = do
  (body, (_, bindings, _)) <- State.runStateT (lower rootExpression) (0 :: Int, [], M.empty)
  pure $ TH.ValD pattern (TH.NormalB (if null bindings then body else TH.LetE (reverse bindings) body)) declarations
  where
    -- Preserve sharing in the compiler's closure graph rather than expanding
    -- the same captured action once for every use. Stable names are inspection
    -- bookkeeping only; they do not enter the executable compiler.
    lower :: Data a => a -> State.StateT (Int, [TH.Dec], M.Map Int [(StableName TH.Exp, TH.Exp)]) IO a
    lower x = case Data.cast x of
      Just expression' -> do
        expression <- liftIO (evaluate expression')
        key <- liftIO (makeStableName expression)
        (_, _, cache) <- State.get
        case lookup key (M.findWithDefault [] (hashStableName key) cache) of
          Just body -> pure $ fromMaybe x (Data.cast body)
          Nothing -> do
            body <- lowerExpression expression
            State.modify (\(index, bindings, memo) -> (index, bindings,
              M.insertWith (++) (hashStableName key) [(key, body)] memo))
            pure $ fromMaybe x (Data.cast body)
      Nothing -> gmapM lower x
    lowerExpression (TH.LetE (TH.PragmaD (TH.LineP 0 "solidvm-captures") : bindings) body) = do
      captures <- forM bindings $ \case
        TH.ValD (TH.VarP name) (TH.NormalB rhs) [] -> do
          rhs' <- lower rhs
          case rhs' of
            TH.VarE action -> pure ((name, action), Nothing)
            _ -> do
              (index, accumulated, cache) <- State.get
              let capture = TH.mkName ("capture_" ++ TH.nameBase name ++ "_" ++ show index)
              State.put (index + 1, accumulated, cache)
              pure ((name, capture), Just (TH.ValD (TH.VarP capture) (TH.NormalB rhs') []))
        _ -> error "unexpected capture declaration"
      let names = map fst captures
          renamed = mapMaybe snd captures
      State.modify (\(index, accumulated, cache) -> (index, reverse renamed ++ accumulated, cache))
      lowered <- lower (renameNames names body)
      (index, accumulated, cache) <- State.get
      let name = TH.mkName ("action_" ++ show index)
      State.put (index + 1, TH.ValD (TH.VarP name) (TH.NormalB lowered) [] : accumulated, cache)
      pure (TH.VarE name)
    lowerExpression (TH.LetE localDeclarations body) = do
      declarations' <- lower localDeclarations
      body' <- lower body
      -- TH's explicit-brace printer needs a declaration separator per equation.
      let equations (TH.FunD name clauses) = map (TH.FunD name . (: [])) clauses
          equations declaration = [declaration]
      pure $ TH.LetE (concatMap equations declarations') body'
    lowerExpression (TH.SigE expression annotation) = do
      lowered <- lower expression
      case lowered of
        TH.VarE name | take 7 (TH.nameBase name) == "action_" -> do
          State.modify (\(index, bindings, cache) -> (index,
            if any (\case TH.SigD n _ -> n == name; _ -> False) bindings
              then bindings else TH.SigD name annotation : bindings, cache))
          pure lowered
        _ -> pure (TH.SigE lowered annotation)
    lowerExpression expression = gmapM lower expression
    renameNames :: Data a => [(TH.Name, TH.Name)] -> a -> a
    renameNames names x = case Data.cast x of
      Just n -> fromMaybe x (Data.cast (fromMaybe n (lookup n names)))
      Nothing -> gmapT (renameNames names) x
flattenDeclaration declaration = pure declaration
