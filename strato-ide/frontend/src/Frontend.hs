{-# LANGUAGE DataKinds #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Frontend where

import Control.Monad
import Control.Applicative
import qualified Data.Aeson as Aeson
import Data.ByteString.Lazy (fromStrict, toStrict)
import Data.List.NonEmpty (nonEmpty)
import Data.Text (Text)
import qualified Data.Text as T
import Text.URI

import Obelisk.Frontend
import Obelisk.Route
import Obelisk.Generated.Static

import Reflex.Dom.ACE
import Reflex.Dom.Core

import Common.Message
import Common.Route

import Frontend.Nav

frontend :: Frontend (R FrontendRoute)
frontend = Frontend
  { _frontend_head = do
      el "title" $ text "Obelisk Minimal Example"
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

app :: MonadWidget t m => Maybe Text -> m ()
app route = mdo
  ace <- appAceWidget evAnnotations
  evCompile <- dynButton $ "Compile"
  let codeEv = tag (current ace) evCompile -- codeEv is currently an Event
  evAnns <- wsEv route $ C2Scompile <$> codeEv
  let evAnnotations = (\case (S2Cannotations anns) -> map toAnnotation anns) <$> evAnns
  
  -- next step is to display the debug output
  evDb <- wsEv route $ C2SdebugCode <$> codeEv
  let evDebug = (\case (S2CdebugCode db) -> db) <$> evDb
  debugOutputWidget evDebug
  
  -- the create contract text input
  createContractWidget route $ ace
  
  pure ()
 
appAceWidget :: MonadWidget t m => Event t [Annotation] -> m (Dynamic t Text)
appAceWidget evAnnotations = do
  elAttr "style" ("type" =: "text/css" <> "media" =: "screen") $ text $ T.unlines
      [ "#ace-editor { width:100%; height:100%; }"
      , "#editor { position:relative; height:400px; left:-10px; padding:10px; }"
      , "body { width:100%; height:100%; }"
      , "input { width:600px; }"
      ]
  ace <- elAttr "div" ("id" =: "editor") $ do
    let cfg = def{ _aceConfigBasePath        = Just "/"
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
        
  
debugOutputWidget :: MonadWidget t m => Event t Text -> m ()
debugOutputWidget debugOutput = do
  tmpOut <- holdDyn "" debugOutput
  el "debugOutput" $ dynText tmpOut
  
createContractWidget :: MonadWidget t m => Maybe Text -> Dynamic t Text -> m ()
createContractWidget route codeDyn = do
  el "div" $ text "Enter in the name of the contract you want to create: "

  textDynamic <- el "contractName" $ do
    ti <- inputElement def
    return $ value ti
        
  submitEvent <- elClass "div" "contractButton" $ do
    submitButton <- elAttr "domEvent" ("class" =: "submitButton") $ button "Create Contract"
    return submitButton
        
      
  let contractEv = tagPromptlyDyn textDynamic submitEvent
  contractName <- holdDyn "" contractEv
  
  --let contractEv = tag (current contractName) submitEvent
  
  
  let bundleDyn = C2ScreateContractBundle <$> contractName <*> codeDyn
  evCon <- wsEv route $ tagPromptlyDyn bundleDyn submitEvent
  
  let evContract = (\case (S2CcreateContract cc) -> cc) <$> evCon
  tmpContractName <- holdDyn "" evContract
  el "contractName" $ dynText tmpContractName
  pure ()
  

mapTuple :: (a -> b) -> (a, a) -> (b, b)
mapTuple f (a1, a2) = (f a1, f a2)