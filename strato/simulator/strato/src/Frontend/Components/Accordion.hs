{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Components.Accordion where

import Control.Lens
import Data.Default
import Data.Text (Text)
import Frontend.Components.SVG.ChevronDown
import Frontend.Components.SVG.ChevronUp
import Frontend.Utils (whenDyn)
import Reflex.Dom

data AccordionProps = AccordionProps
  { _ap_class :: Text
  } deriving (Eq, Ord)

instance Default AccordionProps where
  def = AccordionProps ""

makeLenses ''AccordionProps

data AccordionTrigger m = AccordionTrigger
  { _at_class :: Text
  , _at_body  :: m ()
  }

makeLenses ''AccordionTrigger

data AccordionContent m = AccordionContent
  { _ac_class :: Text
  , _ac_body  :: m ()
  }

makeLenses ''AccordionContent

accordionItem :: MonadWidget t m => AccordionTrigger m -> AccordionContent m -> m ()
accordionItem trigger content = el "div" $ mdo
  isOpen <- toggle False $ domEvent Click e
  (e, _) <- elClass "div" "flex" $
    elClass' "div" ("flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180 " <> trigger ^. at_class) $ do
      trigger ^. at_body
      dyn_ . ffor isOpen $ \case
        False -> chevronDown $ def & svg_class .~ "h-4 w-4 shrink-0 transition-transform duration-200"
        True -> chevronUp $ def & svg_class .~ "h-4 w-4 shrink-0 transition-transform duration-200"
  whenDyn isOpen $
    elClass "div" "overflow-hidden text-sm transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down" $
      elClass "div" ("pb-4 pt-0 " <> content ^. ac_class) $
        content ^. ac_body