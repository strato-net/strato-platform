{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE RankNTypes #-}
module SolidVM.Solidity.Parse
  ( ParseTypeCheckOrSolidVMError(..),
    parseSource,
    parseSourceWithAnnotations,
    compileSourceNoInheritance,
    xabiToContract,
    applyInheritance,
    resolveLabels
  ) where

import Control.Lens
import           Data.Bifunctor                       (first)
import           Data.Foldable                        (foldrM)
import           Data.Map                             (Map)
import qualified Data.Map                             as M
import           Data.Maybe                           (catMaybes)
import           Data.Source
import qualified Data.Text                            as T
import           Data.Traversable                     (for)
import           Text.Parsec                          (runParser)
import           Text.Parsec.Error

import           Blockchain.SolidVM.Exception         hiding (assert)

import           SolidVM.Model.CodeCollection
import qualified SolidVM.Model.CodeCollection.Def as Def
import           SolidVM.Model.SolidString
import qualified SolidVM.Model.Type               as SVMType
import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.File
import           SolidVM.Solidity.Parse.ParserTypes
import           SolidVM.Solidity.Xabi
import qualified SolidVM.Solidity.Xabi as Xabi

data ParseTypeCheckOrSolidVMError = PEx ParseError
                         | TCEx [SourceAnnotation T.Text]
                         | SVMEx (Positioned ((,) SolidException)) deriving (Show) 

withAnnotations :: (a -> Either ParseTypeCheckOrSolidVMError b) -> a -> Either [SourceAnnotation T.Text] b
withAnnotations f = first unwind . f
  where unwind (PEx pe) = [parseErrorToAnnotation pe]
        unwind (SVMEx (e,x)) = [T.pack (show e) <$ x]
        unwind (TCEx errs) = errs

parseSource :: T.Text -> T.Text -> Either ParseTypeCheckOrSolidVMError [SourceUnit]
parseSource fileName src = bimap PEx unsourceUnits $ runParser solidityFile (ParserState "" "") (T.unpack fileName) (T.unpack src)

parseSourceWithAnnotations :: T.Text -> T.Text -> Either [SourceAnnotation T.Text] [SourceUnit]
parseSourceWithAnnotations = withAnnotations . parseSource

compileSourceNoInheritance :: Map T.Text T.Text -> Either ParseTypeCheckOrSolidVMError CodeCollection
compileSourceNoInheritance initCodeMap = do
  let getNamedContracts :: T.Text -> T.Text -> Either ParseTypeCheckOrSolidVMError [(SolidString, Contract)]
      getNamedContracts fileName src = do
        sourceUnits <- parseSource fileName src
        let pragmas = \case
              Pragma _ n v -> Just (n, v)
              _ -> Nothing
            vmVersion' = if (Just ("solidvm","3.2")) `elem` (pragmas <$> sourceUnits) then "svm3.2" else (if (Just ("solidvm","3.0")) `elem` (pragmas <$> sourceUnits) then "svm3.0" else "")
        fmap catMaybes . for sourceUnits $ \case
          NamedXabi name (xabi, parents') -> do
            ctrct <- first SVMEx
                   $ xabiToContract (textToLabel name) (map textToLabel parents') vmVersion' xabi
            pure $ Just (textToLabel name, ctrct)
          _ -> pure Nothing

      throwDuplicate :: (SolidString, Contract) -> Map SolidString Contract -> Either ParseTypeCheckOrSolidVMError (Map SolidString Contract)
      throwDuplicate (cName, contract) m = case M.lookup cName m of
        Nothing -> pure $ M.insert cName contract m
        Just _ ->  Left . PEx
                 $ newErrorMessage (Message $ "Duplicate contract found: " ++ labelToString cName)
                                   (fromSourcePosition $ _sourceAnnotationStart $ _contractContext contract)
                                           
  allContracts <- fmap concat . traverse (uncurry getNamedContracts) $ M.toList initCodeMap
  deduplicatedContracts <- foldrM throwDuplicate M.empty (allContracts :: [(SolidString, Contract)])
  pure $ CodeCollection {
    _contracts = deduplicatedContracts
  }

type SolidEither = Either (Positioned ((,) SolidException))


xabiToContract :: SolidString -> [SolidString] -> String -> Xabi -> SolidEither Contract
xabiToContract contractName' parents' vmVersion' xabi = do
  validateXabi xabi
  constr <- case M.toList $ Xabi.xabiConstr xabi of
    [] -> Right Nothing
    [(_, x)] -> Right $ Just x
    _ -> Left $ ( DuplicateDefinition "multiple constructors in contract" (show contractName') --TODO- figure out if this is allowed in Solidity
                , Xabi.xabiContext xabi
                )
  pure Contract {
  _contractName = contractName',
  _parents = parents',
  _storageDefs = Xabi.xabiVars xabi,
  _constants = Xabi.xabiConstants xabi,
  _enums = M.fromList [(name, (vals, a)) | (name, Def.Enum vals _ a) <- M.toList $ Xabi.xabiTypes xabi],
  _structs = M.fromList [(name, (\(k,v) -> (k,v,a)) <$> vals) | (name, Def.Struct vals _ a) <- M.toList $ Xabi.xabiTypes xabi],
  _events = Xabi.xabiEvents xabi,
  _functions = Xabi.xabiFuncs xabi,
  _modifiers = Xabi.xabiModifiers xabi,
  _constructor = constr,
  _vmVersion = vmVersion',
  _contractContext = Xabi.xabiContext xabi
  }


validateXabi :: Xabi -> SolidEither ()
validateXabi _ = Right ()

{-
validateXabi :: Xabi -> SolidEither ()
validateXabi Xabi{xabiModifiers=mx, xabiContext=ctx} =
  case M.size mx of
      0 -> Right ()
      _ -> Left $ ( TODO "modifiers not supported by solidvm" (show mx)
                  , ctx
                  )
-}

applyInheritance :: CodeCollection -> SolidEither CodeCollection
applyInheritance cc = do
  ccs <- traverse (addInheritedObjects cc) $ cc^.contracts
  pure $ cc{
    _contracts = ccs
  }

addInheritedObjects :: CodeCollection -> Contract -> SolidEither Contract
addInheritedObjects cc c = do
  fu <- toUnionMaker _functions cc c
  sd <- toUnionMaker _storageDefs cc c
  en <- toUnionMaker _enums cc c
  st <- toUnionMaker _structs cc c
  ev <- toUnionMaker _events cc c
  co <- toUnionMaker _constants cc c
  pure $ c{
  _functions=fu,
  _storageDefs=sd,
  _enums=en,
  _structs=st,
  _events = ev,
  _constants=co
  }

toUnionMaker :: (Ord a) => (Contract -> M.Map a b) -> CodeCollection -> Contract -> SolidEither (M.Map a b)
toUnionMaker f cc c = do
  parents' <- getParents cc c
  parentMaps <- traverse (toUnionMaker f cc) parents'
  pure . M.unions $ f c : parentMaps



resolveLabels :: CodeCollection -> CodeCollection
resolveLabels cc = cc{_contracts=fmap (resolveLabelsInContract cc) $ cc^.contracts}


resolveLabelsInContract :: CodeCollection -> Contract -> Contract
resolveLabelsInContract cc c =
  c{_storageDefs=fmap (resolveLabelsInDef (cc^.contracts) (c^.enums) (c^.structs)) $ c^.storageDefs}

resolveLabelsInDef :: Map SolidString Contract -> Map SolidString a -> Map SolidString b -> VariableDecl -> VariableDecl
resolveLabelsInDef contractDefs enumDefs structDefs x@VariableDecl{varType=SVMType.UnknownLabel labelName _} =
  case (labelName `M.member` contractDefs,
        labelName `M.member` structDefs,
        labelName `M.member` enumDefs) of
    (_, True, _) -> x{varType=SVMType.Enum Nothing labelName Nothing}
    (_, _, True) -> x{varType=SVMType.Struct Nothing labelName}
    (True, _, _) -> x{varType=SVMType.Contract labelName}
    _ -> x{varType=SVMType.UnknownLabel labelName Nothing}
    -- _ -> error $ "unknown label in call to resolveLabelsInDef: " ++ labelName
resolveLabelsInDef _ _ _ x = x
