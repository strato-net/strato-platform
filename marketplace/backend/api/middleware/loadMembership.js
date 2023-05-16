import RestStatus from "http-status-codes";
import { rest } from "blockapps-rest";
import config from "../../load.config";
import { RestError } from "blockapps-rest/dist/util/rest.util";
// import { getUserMembershipStates } from '../../helpers/enums'
// import { ROLE } from "../../helpers/constants";
import { USERMEBERSHIP_STATUS } from "helpers/constants";

const attachMembership = async (req, res, next) => {

    let { dapp, address } = req;

    let userMemberships
    let defaultMembershipStatus = { isAdmin: false, isTradingEntity: false, isCertifier: false }

    try {
        // userMemberships = await dapp.getUserMemberships({userAddress: address });
        userMemberships = await dapp.getUserMemberships({ userAddress: address });
        // check if user is already have permissions
        // const isUserExist = await dapp.managers.appPermissionManager.exists({ address })

        if (userMemberships.length === 0) {
            try {
                await dapp.createUserMembership({ userAddress: address, ...defaultMembershipStatus });
                // userMemberships = await dapp.getUserMemberships({userAddress: address});
                // return rest.response.status(RestStatus.FORBIDDEN, res, "User doesn't has necessary permission.");
            } catch (error) {
                const msg = 'Failed to create membership'
                console.warn(msg, error)
                return rest.response.status(RestStatus.FORBIDDEN, res, msg);
            }
        } else {
            const { isAdmin, isTradingEntity, isCertifier } = userMemberships[0]
            defaultMembershipStatus = { isAdmin, isTradingEntity, isCertifier }
        }
        // Check if user has no active permissions then check if he has an open request
        // if (!defaultMembershipStatus.isAdmin && !defaultMembershipStatus.isTradingEntity && !defaultMembershipStatus.isCertifier) {
        //     // TODO fetchUserMembershipRequests and set the flag accordingly
        //     await dapp.getAllUserMembershipRequest({ userAddress: address, state: USERMEBERSHIP_STATUS.NEW })

        //     return rest.response.status(RestStatus.FORBIDDEN, res, "User doesn't has necessary permission.");
        // }

        // userRoles = userMemberships.map(userMembership => userMembership.role)

        // if (!isUserExist) {
        //     if (userRoles.includes(1) || userRoles.includes("1")) {
        //         await dapp.managers.appPermissionManager.grantAdminRole({
        //             user: { address },
        //         });
        //     } else if (userRoles.includes(2) || userRoles.includes("2")) {
        //         await dapp.managers.appPermissionManager.grantTradingEntityRole({
        //             user: { address },
        //         });
        //         if (userRoles.includes(3) || userRoles.includes("3")) {
        //             await dapp.managers.appPermissionManager.grantCertifierRole({
        //                 user: { address },
        //             });
        //         }
        //     } else if (userRoles.includes(3) || userRoles.includes("3")) {
        //         await dapp.managers.appPermissionManager.grantCertifierRole({
        //             user: { address },
        //         });
        //     }
        // }

        // if (userRoles.length === 0) {
        //     return rest.response.status(RestStatus.FORBIDDEN, res, "User is not authorized");
        // }
        // req.members = userMemberships
        // req.roles = { ...defaultMembershipStatus }
        let roleArray = [];
        Object.entries(defaultMembershipStatus).forEach(([key, value], index) => {
            if (value == true) {
                roleArray.push(index + 1);
            }
        });
        req.roles = roleArray;

        console.log('The users has membership : ', userMemberships)
        next()
    } catch (e) {
        next(e)
    }
};

export default attachMembership;