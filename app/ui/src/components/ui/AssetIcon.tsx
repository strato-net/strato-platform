import { useState, type ReactNode } from "react";
import { getVaultIconUrl } from "@/config/vaultIcons";

interface AssetIconProps {
  /** Vault key (e.g. `eth-carry`, `save-usdst`) when the icon is for a yield vault. */
  vaultKey?: string | null;
  /** Image from the token's own metadata, used when this is not a vault. */
  src?: string | null;
  /** Rendered when nothing resolves, or the resolved image fails to load. */
  fallback: ReactNode;
  alt?: string;
  /** Sizing/shape classes for the image, e.g. `h-12 w-12 rounded-full object-cover`. */
  className?: string;
}

/**
 * Icon for an asset, resolved in order: vault artwork from the icon file server
 * (see `@/config/vaultIcons`), then the token's own image metadata, then the
 * caller's placeholder.
 */
const AssetIcon = ({ vaultKey, src, fallback, alt = "", className = "" }: AssetIconProps) => {
  // Tracked by URL, not a boolean: list rows are keyed by index in places, so one
  // instance can be reused for a different asset and must retry the new image.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = getVaultIconUrl(vaultKey) ?? src ?? null;

  if (!url || url === failedUrl) return <>{fallback}</>;

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailedUrl(url)}
    />
  );
};

export default AssetIcon;
