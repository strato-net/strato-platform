const express = require('express');
const MetaMaskController = require('./metamask.controller');

const router = express.Router();

// Returns a web page that triggers the MetaMask extension
router.get(
    '/onboarding',
    MetaMaskController.onboarding
)

// A follow up to the user connecting their MetaMask wallet
// and stores the details in the database
router.post(
    '/onboarding',
    MetaMaskController.completeOnboarding
)

router.get(
    '/onboarding/status',
    MetaMaskController.onboardingStatus
)

router.get(
    '/checkout',
    MetaMaskController.checkout
)

module.exports = router;