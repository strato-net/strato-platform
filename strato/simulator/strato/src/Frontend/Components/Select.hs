{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Components.Select where

import Control.Lens
import Control.Monad (void)
import Data.Bool (bool)
import Data.Default
import Data.Foldable (for_)
import Data.Text (Text)
import Frontend.Utils
import Reflex.Dom

data SelectTrigger m = SelectTrigger
  { _st_id          :: Maybe Text
  , _st_class       :: Text
  , _st_placeholder :: Maybe Text
  , _st_inner       :: m ()
  }

instance Monad m => Default (SelectTrigger m) where
  def = SelectTrigger Nothing "" Nothing blank

makeLenses ''SelectTrigger

data SelectItem m = SelectItem
  { _si_key      :: Maybe Text
  , _si_value    :: Maybe Text
  , _si_class    :: Text
  , _si_disabled :: Bool
  , _si_inner    :: m ()
  }

instance Monad m => Default (SelectItem m) where
  def = SelectItem Nothing Nothing "" False blank

makeLenses ''SelectItem

select' :: MonadWidget t m => SelectTrigger m -> [SelectItem m] -> m (Element EventResult (DomBuilderSpace m) t)
select' st items = mdo
  opened <- toggle False $ domEvent Click e
  (e,_) <- elDynAttr' "button" (opened <&> \o ->
         ("class" =: ("flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1" <> st ^. st_class))
      <> ("data-state" =: bool "closed" "opened" o)
    ) $ st ^. st_inner
  whenDyn opened $ do
    elClass "div" "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1" $
      elClass "div" "p-1 h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]" $
        for_ items $ \i -> elClass "div" "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50" $ do
          elClass "span" "absolute left-2 flex h-3.5 w-3.5 items-center justify-center" $
            blank -- TODO: Check
          i ^. si_inner
  pure e

select :: MonadWidget t m => SelectTrigger m -> [SelectItem m] -> m ()
select st items = void $ select' st items
