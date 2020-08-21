{-# LANGUAGE DataKinds #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}

module Frontend where

import qualified Blockchain.Database.MerklePatricia.NodeData as MP
import qualified Blockchain.Database.MerklePatricia.StateRoot as MP
import Control.Monad
impor Control.Applicative
import qualified Data.Aeson as Aeson
import Data.Bifunctor (bimap)
import Data.ByteString.Lazy (fromStrict, toStrict)
import Data.Foldable (traverse_)
import Data.List (sortOn)
import Data.List.NonEmpty (nonEmpty)
import qualified Data.Map.Strict as M
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as T
import Text.Format
import Text.URI

import Obelisk.Frontend
import Obelisk.Route
import Obelisk.Generated.Static

import Reflex.Dom.ACE
import Reflex.Dom.Core

import SolidVM.Solidity.Parse.File
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Xabi hiding (Event)

import Common.Message
import Common.Route

import Frontend.Nav

frontend :: Frontend (R FrontendRoute)
frontend = Frontend
  { _frontend_head = do
      el "title" $ text "STRATO IDE"
      elAttr "link" ("rel" =: "icon" <> "type" =: "image/png" <> "href" =: static @"img/favicon.png") blank
      el "header" $ nav
      elAttr "link" ("href" =: static @"main.css" <> "type" =: "text/css" <> "rel" =: "stylesheet") blank
      let aceUrl = static @"js/ace/ace.js"
      void $ elAttr' "script" ("type" =: "text/javascript" <> "src" =: aceUrl <> "charset" =: "utf-8") blank
  , _frontend_body = prerender_ blank (app $ Just "http://localhost:8000")
  }

toAnnotation :: Ann -> Annotation
toAnnotation Ann{..} = Annotation
  { annotationRow = annRow
  , annotationColumn = annCol
  , annotationText = annMsg
  , annotationType = if annErr then AnnotationError else AnnotationWarning
  }

dynButton :: MonadWidget t m => Text -> m (Event t ())
dynButton s = do
  (e, _) <- el' "button" $ text s
  pure $ domEvent Click e
 
appAceWidget :: MonadWidget t m => Event t [Annotation] -> m (Dynamic t Text)
appAceWidget evAnnotations = do
  elAttr "style" ("type" =: "text/css" <> "media" =: "screen") $ text $ T.unlines
      [ "#ace-editor { width:100%; height:100%; }"
      , "#editor { position:relative; height:1200px; left:-10px; padding:10px; }"
      , "body { width:100%; height:100%; }"
      , "input { width:600px; }"
      ]
  ace <- elAttr "div" ("id" =: "editor") $ do
    let cfg = def{ _aceConfigBasePath        = Nothing
                  , _aceConfigElemAttrs       = "id" =: "ace-editor"
                  , _aceConfigWordWrap        = True
                  , _aceConfigShowPrintMargin = True
                  }
    aceWidgetStatic cfg (AceDynConfig Nothing) ""
  void $ withAceInstance ace $ setAnnotations <$> evAnnotations
  pure $ aceValue ace

wsEv :: MonadWidget t m => Maybe Text -> Event t C2S -> m (Event t S2C)
wsEv route msgSendEv = case checkEncoder fullRouteEncoder of
  Left err -> do
    el "div" $ text err
    return never
  Right encoder -> do
    let wsPath = fst $ encode encoder $ FullRoute_Backend BackendRoute_IDE :/ ()
        sendEv = fmap ((:[]) . toStrict . Aeson.encode) msgSendEv
    let mUri = do
          uri' <- mkURI =<< route
          pathPiece <- nonEmpty =<< mapM mkPathPiece wsPath
          wsScheme <- case uriScheme uri' of
            rtextScheme | rtextScheme == mkScheme "https" -> mkScheme "wss"
            rtextScheme | rtextScheme == mkScheme "http" -> mkScheme "ws"
            _ -> Nothing
          return $ uri'
            { uriPath = Just (False, pathPiece)
            , uriScheme = Just wsScheme
            }
    case mUri of
      Nothing -> return never
      Just uri -> do
        ws <- webSocket (render uri) $ def & webSocketConfig_send .~ sendEv
        let mS2c = fromStrict <$> _webSocket_recv ws
        pure $ fmapMaybe Aeson.decode mS2c 

textbox :: MonadWidget t m => m (Dynamic t Text)
textbox = do
  ti <- textInput def
  pure $ _textInput_value ti

xabiWidget :: MonadWidget t m => Dynamic t [File] -> m (Event t (Text, Text))
xabiWidget fileDyn = el "div" $ do
  let getNamedXabi = \case
        NamedXabi n x -> Just (n, x)
        _ -> Nothing
  let namedXabis = sortOn fst 
                 . catMaybes 
                 . map getNamedXabi 
                 . concat  
                 . map unsourceUnits 
                 <$> fileDyn
  createButtonClicks <- simpleList namedXabis $ \xabiDyn -> do -- (name, (Xabi{..}, baseConstrs) -> do
    let name = fst <$> xabiDyn
        xabi = fst . snd <$> xabiDyn
        mConstr = listToMaybe . M.elems . xabiConstr <$> xabi
        constrArgs = maybe [] funcArgs <$> mConstr
    elAttr "div" ("style" =: "background-color: #C0C0F0; padding: 5px; border-radius: 10px; margin: 5px;") $ do
      el "b" $ dynText name
      el "br" blank
      argValues <- el "div" . simpleList (zip [0..] <$> constrArgs) $ \arg -> do
        let argName = (\(index, (mArgName, _)) -> fromMaybe (T.pack $ show index) mArgName) <$> arg
        elAttr "div" ("style" =: "font-family: monospace;") $ do
          dynText argName
          text " "
          textbox
      let argsT = join $ sequence <$> argValues
      let argsText = (\v -> "(" <> T.intercalate ", " v <> ")") <$> argsT
          nameAndArgs = (,) <$> name <*> argsText
      evCreate <- dynButton "Create"
      pure $ tag (current nameAndArgs) evCreate
  pure . switchPromptlyDyn $ leftmost <$> createButtonClicks

mpWidget :: MonadWidget t m => MP.StateRoot -> M.Map MP.StateRoot MP.NodeData -> m ()
mpWidget sr tr = elAttr "div" ("style" =: "left: 10%;") $ do
  let nodeRefWidget = \case
        MP.SmallRef x -> text . T.pack $ show x
        MP.PtrRef sr' -> mpWidget sr' tr
  case M.lookup sr tr of
    Nothing -> el "div" $ do
      text "Nothing"
    Just MP.EmptyNodeData -> el "div" $ do
      text "EmptyNodeData"
    Just (MP.FullNodeData refs mVal) -> el "div" $ do 
      text "FullNodeData"
      el "div" $ traverse_ nodeRefWidget refs
      maybe blank (text . T.pack . show) mVal
    Just (MP.ShortcutNodeData nKey nVal) -> el "div" $ do
      text "ShortcutNodeData: "
      text (T.pack $ show nKey)
      case nVal of
        Right val -> text (T.pack $ show val)
        Left ref -> nodeRefWidget ref

app :: MonadWidget t m => Maybe Text -> m ()
app route = mdo
  let styleAttrs = T.concat [ "display: grid;"
                            , "grid-template-columns: 50% 50%;"
                            , "grid-template-rows: 1fr;"
                            , "height: 100%;"
                            ]
      containerAttrs = "class" =: "grid-container" <> "style" =: styleAttrs
  (evCompileRes, evCreateArgs) <- elAttr "div" containerAttrs $ do
    ace <- appAceWidget evAnnotations
    evCompile <- debounce 0.1 $ updated ace
    let evParse = parseSolidity <$> evCompile
    let evCompileRes = bimap toAnn (T.pack . show) <$> evParse
    evCompilationSuccess <- foldDyn (\a b -> either (const b) (:[]) a) [] evParse
    evCreate <- xabiWidget evCompilationSuccess
    let createArgs = attachPromptlyDynWith
          (\t (n, a) -> CreateArgs n a t)
          ace
          evCreate
    pure (evCompileRes, createArgs)
  evGetMP <- dynButton "Get MP"
  void $ widgetHold blank (uncurry mpWidget <$> evMP)
  -- c2sCallDyn = CallArgs <$> contractNameDyn <*> contractArgsDyn
  let evC2S = leftmost [ C2Screate <$> evCreateArgs
                       -- , C2Scall <$> tag (current c2sCallDyn) evCall 
                       , C2SgetMP <$ evGetMP
                       ]
  evS2C <- wsEv route evC2S
  let evAnnotations = fmapMaybe toAnnotations evCompileRes
      evResult = fmapMaybe toResult $ leftmost [S2CcompileResult <$> evCompileRes, evS2C]
      evMP = fmapMaybe toMP evS2C
  pure ()
  where toAnnotations = either (Just . map toAnnotation) (Just . const [])
        toResult = \case
          S2CcompileResult e -> either (Just . const "") Just e
          S2CcreateResult e -> Just . T.pack $ show e
          S2CcallResult e -> Just . T.pack $ show e
          _ -> Nothing
        toMP = \case
          S2CMP sr mp -> Just (sr, mp)
          _ -> Nothing