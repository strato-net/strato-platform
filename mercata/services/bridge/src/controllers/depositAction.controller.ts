import { requestDepositAction } from "../services/depositActionService";
import { Request, Response, NextFunction } from "express";
import { verifyMessage } from "ethers";
import { DEPOSIT_EVENT_SIGNATURE } from "../config";
import { getEnabledChains } from "../services/cirrusService";
import { getTransactionReceiptsBatch } from "../services/rpcService";

const ZERO_ADDRESS = "0000000000000000000000000000000000000000";
const MAX_AUTHORIZATION_LIFETIME_SECONDS = 15 * 60;

const normalizeHex = (value: string) => value.toLowerCase().replace(/^0x/, "");

const buildDepositActionAuthorization = ({
  userAddress,
  externalChainId,
  externalTxHash,
  action,
  targetToken,
  deadline,
}: {
  userAddress: string;
  externalChainId: string;
  externalTxHash: string;
  action: number;
  targetToken: string;
  deadline: string;
}) => [
  "MercataBridge Deposit Action",
  `user:${normalizeHex(userAddress)}`,
  `externalChainId:${externalChainId}`,
  `externalTxHash:${normalizeHex(externalTxHash)}`,
  `action:${action}`,
  `targetToken:${normalizeHex(targetToken || ZERO_ADDRESS)}`,
  `deadline:${deadline}`,
].join("\n");

class DepositActionController {
  static async requestDepositAction(req: Request, res: Response, next: NextFunction) {
    let userAddress: string = res.locals.userAddress;
  
    const { externalChainId, externalTxHash, action, targetToken, userAddress: requestedUser, signature, deadline } = req.body;
    if (!externalChainId || !externalTxHash || !action) {
      return res.status(400).json({
        error: "Missing required parameters: externalChainId, externalTxHash, and action"
      });
    }
  
    try {
      if (requestedUser || signature || deadline) {
        if (!requestedUser || !signature || !deadline) {
          return res.status(400).json({ error: "Incomplete wallet authorization" });
        }

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = Number(deadline);
        if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + MAX_AUTHORIZATION_LIFETIME_SECONDS) {
          return res.status(403).json({ error: "Invalid or expired wallet authorization" });
        }

        const message = buildDepositActionAuthorization({
          userAddress: requestedUser,
          externalChainId: String(externalChainId),
          externalTxHash,
          action: Number(action),
          targetToken: targetToken || ZERO_ADDRESS,
          deadline,
        });
        let signer: string;
        try {
          signer = normalizeHex(verifyMessage(message, signature));
        } catch {
          return res.status(403).json({ error: "Invalid wallet authorization signature" });
        }
        if (signer !== normalizeHex(requestedUser)) {
          return res.status(403).json({ error: "Wallet authorization signer mismatch" });
        }

        const chainId = Number(externalChainId);
        const chainInfo = (await getEnabledChains()).get(chainId);
        const receipts = await getTransactionReceiptsBatch(chainId, [externalTxHash]);
        const receipt = receipts.get(externalTxHash);
        const hasAuthorizedDeposit = receipt?.status === "0x1" && receipt.logs?.some((log: any) =>
          normalizeHex(log.address) === normalizeHex(chainInfo?.depositRouter || "") &&
          normalizeHex(log.topics?.[0] || "") === normalizeHex(DEPOSIT_EVENT_SIGNATURE) &&
          normalizeHex(log.topics?.[3] || "").slice(-40) === signer
        );
        if (!hasAuthorizedDeposit) {
          return res.status(403).json({ error: "Wallet authorization does not match a confirmed bridge deposit" });
        }
        userAddress = signer;
      }

      const result = await requestDepositAction({
        userAddress,
        externalChainId,
        externalTxHash,
        action: Number(action),
        targetToken: targetToken || "0000000000000000000000000000000000000000",
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default DepositActionController;
