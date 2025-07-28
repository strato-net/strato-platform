import { useState, useEffect, useCallback } from "react";
import { useIsMobile } from "./use-mobile";

export const useMobileTooltip = (containerClass: string) => {
  const isMobile = useIsMobile();
  const [showTooltip, setShowTooltip] = useState(false);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowTooltip(prev => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setShowTooltip(false);
  }, []);

  // Close tooltip when clicking outside
  useEffect(() => {
    if (!isMobile || !showTooltip) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest(`.${containerClass}`)) {
        setShowTooltip(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isMobile, showTooltip, containerClass]);

  return {
    isMobile,
    showTooltip,
    handleToggle,
    handleClose,
    shouldUseMobile: isMobile,
  };
}; 