## Voucher

Purpose: Fee payment and incentives via vouchers.

Functional summary:
- Issue vouchers and accept them in place of USDST for eligible protocol fees.

Key contracts:
- Voucher.sol: Voucher token/records for entitlements or discounts.
- PayFeesWithVoucher.sol: Allows paying fees using vouchers instead of USDST.

Core flows:
- Issue: Admin/mint vouchers per policy.
- Redeem: Apply voucher to offset specific protocol fees.

Dev notes:
- Integrate with protocol components that support alternative fee payment.


