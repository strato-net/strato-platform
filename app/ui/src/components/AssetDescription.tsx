import { useMemo } from "react";
import { formatDescriptionHtml } from "@/lib/descriptionHtml";

interface AssetDescriptionProps {
  /** Description HTML as stored for the token or asset. */
  html: unknown;
  className?: string;
}

/** An asset's description, in the app's typography. */
const AssetDescription = ({ html, className }: AssetDescriptionProps) => {
  const formatted = useMemo(() => formatDescriptionHtml(html), [html]);
  return (
    <div
      className={className}
      data-testid="asset-description"
      dangerouslySetInnerHTML={{ __html: formatted }}
    />
  );
};

export default AssetDescription;
