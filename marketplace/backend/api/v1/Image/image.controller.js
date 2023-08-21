import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import moment from "moment";
import crypto from "crypto";
import { uploadFileToS3, deleteFileFromS3 } from "../../../helpers/s3";
import constants from '../../../helpers/constants';
const options = { config, cacheNonce: true }
import aws from 'aws-sdk'
class ImageController {

  static async uploadImage(req, res, next) {

    if (!req.file) {
      rest.response.status400(res, "Missing file");
    }
    try {
      const fileKey = `${moment()
        .utc()
        .valueOf()}_${req.file.originalname}`;

      const fileHash = crypto
        .createHmac("sha256", req.file.buffer)
        .digest("hex");

      const uploadResult = await uploadFileToS3(
        `${fileKey}`,
        req.file.buffer,
        req.app.get(constants.s3ParamName)
      );
      
      const result={
        imageKey:fileKey,
        docHash:fileHash,
        originalName: req.file.originalname
      }

  
      rest.response.status201(res, result);
    } catch (e) {
      return next(e);
    }
  }

  static async updateImage(req, res, next) {

    if (!req.file) {
      rest.response.status400(res, "Missing file");
    }
    if(!req.params.fileKey){
      rest.response.status400(res, "Missing file key");
    }
    try {
      
      const fileKey = `${moment()
        .utc()
        .valueOf()}_${req.file.originalname}`;
      
      const uploadResult = await uploadFileToS3(
        `${fileKey}`,
        req.file.buffer,
        req.app.get(constants.s3ParamName)
      );
      
      const result={
        imageKey:fileKey
      }

  
      rest.response.status200(res, result);
    } catch (e) {
      return next(e);
    }
  }

}

export default ImageController
