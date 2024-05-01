import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
    switch (action.type) {
        case actionDescriptors.requestReview:
            return {
                ...state,
                requestingReview: true,
            }
        case actionDescriptors.requestReviewSuccessful:
            return {
                ...state,
                requestingReview: false,
            }
        case actionDescriptors.requestReviewFailed:
                return {
                    ...state,
                    requestingReview: false,
                }            
        case actionDescriptors.authorizeSeller:
            return {
                ...state,
                changingSellerStatus: true,
            };
        case actionDescriptors.authorizeSellerSuccessful:
            return {
                ...state,
                changingSellerStatus: false,
            };
        case actionDescriptors.authorizeSellerFailed:
            return {
                ...state,
                changingSellerStatus: false,
            };
        default:
            throw new Error(`Unhandled action: '${action.type}'`);
    }
}

export default reducer;