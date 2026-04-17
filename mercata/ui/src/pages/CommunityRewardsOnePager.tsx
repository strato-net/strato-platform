import { useEffect, useState } from "react";
import pageHtml from "../strato-memecoin-partnership-onepager.html?raw";

/**
 * Full-page iframe rendered from a blob URL so the one-pager HTML is delivered
 * inline with the JS bundle and is not fetched as a separate .html asset
 * (avoids WAF/Cloudflare blocks on raw .html requests in production).
 */
const CommunityRewardsOnePager = () => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([pageHtml], { type: "text/html" }));
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, []);

  return (
    <main className="fixed inset-0 z-[100] bg-[#F4F5FB]">
      {blobUrl && <iframe title="STRATO Community Partnership Program" src={blobUrl} className="h-full w-full border-0" />}
    </main>
  );
};

export default CommunityRewardsOnePager;
