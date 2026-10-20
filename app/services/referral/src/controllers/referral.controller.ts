import { redeemReferral } from "../services/referralService";
import { Request, Response, NextFunction } from "express";

class ReferralController {
  static async redeemReferral(req: Request, res: Response, next: NextFunction) {
    try {
      const { v, r, s, recipient, nft } = req.body || {};

      const json = await redeemReferral({ v, r, s, recipient, nft: !!nft });
      res.json({ ok: true, submitted: json });
    } catch (e: any) {
      // The reason in words: an Error serialises to {} otherwise.
      res.status(400).json({ ok: false, error: e?.message ?? String(e) });
    }
  }
}

export default ReferralController;