import express from "express";
import OfferController from "./offer.controller";
import { Offer } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
    Offer.get,
    authHandler.authorizeRequest(),
    loadDapp,
    OfferController.get
);

router.get(
    Offer.getAll,
    authHandler.authorizeRequest(),
    loadDapp,
    OfferController.getAll
);

router.post(
    Offer.create,
    authHandler.authorizeRequest(),
    loadDapp,
    OfferController.create
)

router.post(
    Offer.update,
    authHandler.authorizeRequest(),
    loadDapp,
    OfferController.update
)

router.post(
    Offer.accept,
    authHandler.authorizeRequest(),
    loadDapp,
    OfferController.accept
)

router.post(
    Offer.reject,
    authHandler.authorizeRequest(),
    loadDapp,
    OfferController.reject
)

router.post(
    Offer.cancel,
    authHandler.authorizeRequest(),
    loadDapp,
    OfferController.cancel
)

router.get(
    Offer.getIncomingOffers,
    authHandler.authorizeRequest(),
    loadDapp,
    OfferController.getIncomingOffers
)

router.get(
    Offer.getOutgoingOffers,
    authHandler.authorizeRequest(),
    loadDapp,
    OfferController.getOutgoingOffers
)


export default router;