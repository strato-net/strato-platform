import type { ReactNode } from "react";
import type { GovernedCallResult } from "@strato/shared-types";
import { formatHash } from "@/utils/numberUtils";
import CopyButton from "@/components/ui/copy";

const message = ({ executed, issueId, hash }: GovernedCallResult): ReactNode => {
  if (issueId && !executed) return `Vote submitted · issue ${formatHash(issueId)}`;
  // Executed, signed with an external wallet, or the issue lookup timed out
  return (
    <>
      {formatHash(hash)}
      <CopyButton address={hash} />
    </>
  );
};

/** What a governed call did: it ran, the vote was recorded, or a wallet sent it. Nothing before the first call. */
const GovernedCallNote = ({ result, children }: { result: GovernedCallResult | undefined; children?: ReactNode }) =>
  result ? (
    <p role="status" className="text-xs text-muted-foreground">
      {message(result)}
      {children}
    </p>
  ) : null;

export default GovernedCallNote;
