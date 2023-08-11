import Seeder from './service.json';
import {assert} from "blockapps-rest"

const {services}=Seeder

const createServices=async (dapp)=>{
    try {
        assert.isDefined(dapp.createService,"createCategory should be defined")
                
        const result=[]
        
        for(let service of services){
            const [,address] = await dapp.createService(service)
            result.push(address)

        }
        return result
        
    } catch (error) {
        throw new Error(error)
    }
}

export default {
    createServices
}
