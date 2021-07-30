import express from "express";
import moment from "moment";

import * as packageJson from "../../package.json";
import { deployParamName } from "../../helpers/constants";

import { Authentication, Users, Organizations, Applications } from "./endpoints";

import authentication from './authentication';
import users from './users';
import organizations from './organizations';
import applications from './applications';

const router = express.Router();

router.use(Authentication.prefix, authentication)
router.use(Users.prefix, users)
router.user(Organizations.prefix, organizations)
router.user(Applications.prefix, applications)

router.get(`/health`, (req, res) => {
  const deployment = req.app.get(deployParamName);
  res.json({
    name: packageJson.name,
    name: packageJson.name,
    description: packageJson.description,
    version: packageJson.version,
    timestamp: moment().unix(),
    deployment
  });
});

export default router;
