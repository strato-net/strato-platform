import Seeder from './seeder.json';
import {assert} from "blockapps-rest"

const {categories}=Seeder

const createCategoriesWithSubCategories=async (dapp)=>{
    try {
        assert.isDefined(dapp.createCategory,"createCategory should be defined")
        assert.isDefined(dapp.createSubCategory,"createSubCategory should be defined")
        
        const result=[]
        const subCategoryMap = {}; // to store subcategories with their name and address
        
        for(let category of categories){
            const {subCategories}=category
            const [,categoryAddress]=await dapp.createCategory(category)
            result.push(categoryAddress)

            for(let subCategory of subCategories){
                const {name, products}=subCategory
                let subCategoryAddress = subCategoryMap[name]; // check if subcategory already exists
                if (!subCategoryAddress) { // create new subcategory if it doesn't exist
                    const [,newSubCategoryAddress]= await dapp.createSubCategory({...subCategory,categoryAddress});
                    subCategoryAddress = newSubCategoryAddress;
                    subCategoryMap[name] = subCategoryAddress; // store the new subcategory in the map
                }

                for(let product of products){                        
                    const {inventories}=product
                    const [,productAddress]= await dapp.createProduct({...product, productArgs: {
                        ...product.productArgs,
                        categoryId: categoryAddress,
                        subCategoryId: subCategoryAddress
                      }});
                      
                    for(let inventory of inventories){
                        await dapp.createInventory({...inventory, productAddress});
                    }

                }
            }
        }
        return result
        
    } catch (error) {
        throw new Error(error)
    }
}

export default {
    createCategoriesWithSubCategories
}
