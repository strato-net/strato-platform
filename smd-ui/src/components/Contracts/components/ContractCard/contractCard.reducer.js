
import {
    FETCH_CONTRACT_INFO_FAILURE,
    FETCH_CONTRACT_INFO_SUCCESS
} from './contractCard.actions'

const initialState = {
    contractInfos: {}
}

const reducer = (state = initialState, action) => {
    switch (action.type) {
        case FETCH_CONTRACT_INFO_SUCCESS:
            return {
                contractInfos: {
                    ...state.contractInfos,
                    [action.key]: {
                        ...state.contractInfos[action.key],
                        ...action.data
                    }
                }
            }
        case FETCH_CONTRACT_INFO_FAILURE:
            return {
                contractInfos: {
                    ...state.contractInfos,
                    [action.key]: {
                        ...state.contractInfos[action.key],
                        error: action.error
                    }
                }
            }
        default:
            return state
    }
}
export default reducer