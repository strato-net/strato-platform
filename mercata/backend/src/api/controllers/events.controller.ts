import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getEvents } from "../services/events.service";

class EventsController {
  static async getEvents(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const events = await getEvents(accessToken, query as Record<string, string>);
      res.status(RestStatus.OK).json(events);
    } catch (error) {
      next(error);
    }
  }

  static async getContractInfo(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      // Hardcoded contract information based on the Mercata contracts
      const contractInfo = {
        contracts: [
          {
            name: "LendingPool",
            events: [
              "Deposited",
              "Withdrawn", 
              "Borrowed",
              "Repaid",
              "Liquidated",
              "SuppliedCollateral",
              "WithdrawnCollateral",
              "ExchangeRateUpdated",
              "InterestDistributed",
              "AssetConfigured"
            ]
          },
          {
            name: "Pool",
            events: [
              "Swap",
              "AddLiquidity",
              "RemoveLiquidity"
            ]
          },
          {
            name: "Token",
            events: [
              "Transfer",
              "Approval",
              "StatusChanged"
            ]
          },
          {
            name: "MercataEthBridge",
            events: [
              "DepositInitiated",
              "DepositCompleted",
              "WithdrawalInitiated",
              "WithdrawalPendingApproval",
              "WithdrawalCompleted",
              "RelayerUpdated",
              "MinAmountUpdated",
              "TokenFactoryUpdated"
            ]
          },
          {
            name: "RewardsManager",
            events: [
              "RewardTokenAdded",
              "RewardTokenRemoved",
              "EligibleTokenAdded", 
              "EligibleTokenRemoved",
              "RewardFactorSet",
              "RewardBalanceUpdated",
              "RewardClaimed",
              "RewardDelegateUpdated"
            ]
          },
          {
            name: "PoolFactory",
            events: [
              "PoolCreated"
            ]
          },
          {
            name: "TokenFactory",
            events: [
              "TokenCreated",
              "TokenStatusUpdated"
            ]
          },
          {
            name: "LendingRegistry",
            events: [
              "AssetRegistered",
              "AssetUnregistered"
            ]
          },
          {
            name: "CollateralVault",
            events: [
              "CollateralDeposited",
              "CollateralWithdrawn"
            ]
          },
          {
            name: "PriceOracle",
            events: [
              "PriceUpdated"
            ]
          }
        ]
      };

      res.status(RestStatus.OK).json(contractInfo);
    } catch (error) {
      next(error);
    }
  }
}

export default EventsController; 