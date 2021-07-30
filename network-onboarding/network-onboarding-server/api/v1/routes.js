import express from "express";
import moment from "moment";

import * as packageJson from "../../package.json";
import { deployParamName } from "../../helpers/constants";

import { Authentication, User, Organization, Application } from "./endpoints";

const router = express.Router();

router.use(Authentication.prefix, authentication)
router.use(User.prefix, user)
router.user(Organization.prefix, organization)

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

// TODO: Authenticated route example

export default router;
