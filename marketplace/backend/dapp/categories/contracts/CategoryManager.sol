 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/categories/contracts/Category.sol";
import "/dapp/categories/contracts/SubCategory.sol";
contract CategoryManager is RestStatus{
    mapping(string=>int)  categoriesMap;
    mapping(string=>int) subCategoriesMap;
    Category[] categories;
    SubCategory[] subCategories;


    function createCategory(string _name, string _description,string _imageKey, uint _createdDate) public returns(uint256, address){
        // if(categoriesMap[_name] != 0) {
        //     return (RestStatus.CONFLICT,address(0));
        // }

        Category category = new Category( _name, _description,_imageKey, _createdDate);
        categories.push(category);
        // categoriesMap[_name]=categories.length;
        return (RestStatus.CREATED, address(category));
    }

    function updateCategory(address _category, string _name, string _description,string _imageKey, uint _scheme) public returns(uint256, address){
        Category category = Category(_category);
        category.update(_name, _description,_imageKey, _scheme);
        return (RestStatus.OK, address(category));
    }

    function createSubCategory(address _category, string _name, string _description, uint _createdDate) public returns(uint256, address){
        Category category = Category(_category);
        return category.addSubCategory(_name, _description, _createdDate);
    }

    function updateSubCategory(address _category, address _subCategory, string _name, string _description, uint _scheme) public returns(uint256, address){
        Category category = Category(_category);
        return category.updateSubCategory(_subCategory, _name, _description, _scheme);
    }
}
