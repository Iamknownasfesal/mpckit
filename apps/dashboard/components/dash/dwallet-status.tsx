import { StatusPill } from "@/components/dash/status-pill";

/**
 * Render the dWallet lifecycle status as a coloured pill. Lived as an
 * identical local `DStatus` in three pages (overview, dwallets list,
 * dwallet detail) before being lifted here.
 */
export function DwalletStatus({ status }: { status: string }) {
  if (status === "Active") return <StatusPill tone="live">{status}</StatusPill>;
  if (status === "AwaitingKeyHolderSignature")
    return (
      <StatusPill tone="warn" pulse>
        awaiting share
      </StatusPill>
    );
  if (status === "Failed")
    return <StatusPill tone="danger">{status}</StatusPill>;
  return <StatusPill tone="neutral">{status}</StatusPill>;
}
