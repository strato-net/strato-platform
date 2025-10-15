import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getAdmin, isUserAdmin, addAdmin, removeAdmin, castVoteOnIssue, castVoteOnIssueById, getOpenIssues,
         contractSearch, getContractDetails,
 } from "../services/user.service";
import { validateUserAddress, validateAddressField } from "../validators/common.validators";

class UserController {
  static async me(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { address: userAddress, accessToken, userName } = req;
      const isAdmin = await isUserAdmin(accessToken, userAddress);
      
      res.status(RestStatus.OK).json({ userAddress, isAdmin, userName });
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

  static async castVoteOnIssue(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: actorAddress } = req;
      const { target, func, args } = req.body;
      console.log("here we are 4");
      validateAddressField(target);
      
      const result = await castVoteOnIssue(accessToken, actorAddress as string, target, func, args);
      res.status(RestStatus.OK).json({ 
        message: "Vote cast successfully", 
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

  static async getOpenIssues(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const issues = await getOpenIssues(accessToken);
      res.status(RestStatus.OK).json(issues);
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
