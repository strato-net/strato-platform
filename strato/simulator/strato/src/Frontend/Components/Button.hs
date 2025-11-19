{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Components.Button where

import Control.Lens
import Data.Default
import Data.Text (Text)
import qualified Data.Text as T
import Reflex.Dom

data ButtonVariant = BVDefault
                   | BVDestructive
                   | BVOutline
                   | BVSecondary
                   | BVGhost
                   | BVLink

makePrisms ''ButtonVariant

instance Default ButtonVariant where
  def = BVDefault

data ButtonSize = BSDefault
                | BSSmall
                | BSLarge
                | BSIcon

makePrisms ''ButtonSize

instance Default ButtonSize where
  def = BSDefault

data ButtonProps = ButtonProps
  { _bpVariant   :: ButtonVariant
  , _bpSize      :: ButtonSize
  , _bpAsChild   :: Bool
  , _bpClassName :: Text
  }

makeLenses ''ButtonProps

instance Default ButtonProps where
  def = ButtonProps BVDefault BSDefault False ""

buttonVariantClass :: ButtonVariant -> Text
buttonVariantClass BVDefault = "bg-primary text-primary-foreground hover:bg-primary/90"
buttonVariantClass BVDestructive = "bg-destructive text-destructive-foreground hover:bg-destructive/90"
buttonVariantClass BVOutline = "border border-input bg-background hover:bg-accent hover:text-accent-foreground"
buttonVariantClass BVSecondary = "bg-secondary text-secondary-foreground hover:bg-secondary/80"
buttonVariantClass BVGhost = "hover:bg-accent hover:text-accent-foreground"
buttonVariantClass BVLink = "text-primary underline-offset-4 hover:underline"

buttonSizeClass :: ButtonSize -> Text
buttonSizeClass BSDefault = "h-10 px-4 py-2"
buttonSizeClass BSSmall = "h-9 rounded-md px-3"
buttonSizeClass BSLarge = "h-11 rounded-md px-8"
buttonSizeClass BSIcon = "h-10 w-10"

buttonPropsClass :: ButtonProps -> Text
buttonPropsClass (ButtonProps bv bs _ cn) = T.intercalate " "
  [ "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
  , buttonVariantClass bv
  , buttonSizeClass bs
  , cn
  ]

button' :: MonadWidget t m => Dynamic t ButtonProps -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
button' buttonPropsDyn inner =
  -- TODO: asChild should be slot
  elDynClass' "button" (buttonPropsClass <$> buttonPropsDyn) inner

button :: MonadWidget t m => Dynamic t ButtonProps -> m a -> m a
button buttonPropsDyn inner = snd <$> button' buttonPropsDyn inner