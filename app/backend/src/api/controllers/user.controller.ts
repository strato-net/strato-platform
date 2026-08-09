import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getAdmin, isUserAdmin, addAdmin, removeAdmin, createIssue, castVoteOnIssueById, simulateCastVoteOnIssue, dismissIssue, getOpenIssues,
         getExecutedIssues, contractSearch, getContractDetails,
 } from "../services/user.service";
import { validateUserAddress, validateAddressField } from "../validators/common.validators";
import { validateIssuesQuery } from "../validators/user.validator";

class UserController {
  static async me(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { address: userAddress, accessToken, userName, isNewUser } = req;
      const isAdmin = await isUserAdmin(accessToken, userAddress);

      res.status(RestStatus.OK).json({ userAddress, isAdmin, userName, isNewUser: !!isNewUser });
      next();
    } catch (e) {
      next(e);
    }
  }

  static async admin(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const admins = await getAdmin(accessToken);
      res.status(RestStatus.OK).json({ admins });
      next();
    } catch (e) {
      next(e);
    }
  }

  static async addAdmin(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: actorAddress } = req;
      const { userAddress } = req.body;

      validateUserAddress(userAddress);

      const result = await addAdmin(accessToken, actorAddress as string, userAddress);
      res.status(RestStatus.CREATED).json({ 
        message: "Admin added successfully", 
        userAddress,
        status: result.status,
        hash: result.hash
      });
      next();
    } catch (e) {
      next(e);
    }
  }

  static async removeAdmin(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: actorAddress } = req;
      const { userAddress } = req.body;

      validateUserAddress(userAddress);

      const result = await removeAdmin(accessToken, actorAddress as string, userAddress);
      res.status(RestStatus.OK).json({ 
        message: "Admin removed successfully", 
        userAddress,
        status: result.status,
        hash: result.hash
      });
      next();
    } catch (e) {
      next(e);
    }
  }

  static async createIssue(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: actorAddress } = req;
      const { target, func, args } = req.body;
      validateAddressField(target);

      const result = await createIssue(accessToken, actorAddress as string, target, func, args);
      res.status(RestStatus.OK).json({
        message: "Issue created successfully",
        target,
        func,
        args,
        status: result.status,
        hash: result.hash,
      });
      next();
    } catch (e) {
      next(e);
    }
  }

  static async simulateCastVoteOnIssue(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: actorAddress } = req;
      const { target, func, args } = req.body;
      validateAddressField(target);

      const result = await simulateCastVoteOnIssue(accessToken, actorAddress as string, target, func, args);
      res.status(RestStatus.OK).json(result);
      next();
    } catch (e) {
      next(e);
    }
  }

  static async castVoteOnIssueById(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: actorAddress } = req;
      const { issueId } = req.body;
      
      const result = await castVoteOnIssueById(accessToken, actorAddress as string, issueId);
      res.status(RestStatus.OK).json({ 
        message: "Vote cast successfully", 
        issueId,
        status: result.status,
        hash: result.hash,
      });
      next();
    } catch (e) {
      next(e);
    }
  }

  static async dismissIssue(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: actorAddress } = req;
      const { issueId } = req.body;
      
      const result = await dismissIssue(accessToken, actorAddress as string, issueId);
      res.status(RestStatus.OK).json({ 
        message: "Issue dismissed successfully", 
        issueId,
        status: result.status,
        hash: result.hash,
      });
      next();
    } catch (e) {
      next(e);
    }
  }

  static async getOpenIssues(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      validateIssuesQuery(req.query);
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const issues = await getOpenIssues(accessToken, page, limit);
      res.status(RestStatus.OK).json(issues);
      next();
    } catch (e) {
      next(e);
    }
  }

  static async getExecutedIssues(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      validateIssuesQuery(req.query);
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const result = await getExecutedIssues(accessToken, page, limit);
      res.status(RestStatus.OK).json(result);
      next();
    } catch (e) {
      next(e);
    }
  }

  static async contractSearch(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const { search } = query;
      const searchResults = await contractSearch(accessToken, `${search}`);
      res.status(RestStatus.OK).json(searchResults);
      next();
    } catch (e) {
      next(e);
    }
  }

  static async getContractDetails(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const { address } = query;
      const contractDetails = await getContractDetails(accessToken, `${address}`);
      res.status(RestStatus.OK).json(contractDetails);
      next();
    } catch (e) {
      next(e);
    }
  }
}

export default UserController;
