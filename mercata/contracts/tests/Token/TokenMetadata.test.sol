// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Tokens/TokenMetadata.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract TestTokenMetadata is TokenMetadata, Ownable {
    constructor(
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        address _owner
    ) TokenMetadata(_description, _images, _files, _fileNames) Ownable(_owner) {
    }

    function setMetadata(
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames
    ) external onlyOwner {
        _setMetadata(_description, _images, _files, _fileNames);
    }

    function setAttribute(string key, string value) external onlyOwner {
        _setAttribute(key, value);
    }

    function getDescription() external view returns (string) {
        return description;
    }

    function getImages() external view returns (string[]) {
        return images;
    }

    function getFiles() external view returns (string[]) {
        return files;
    }

    function getFileNames() external view returns (string[]) {
        return fileNames;
    }

    function getAttribute(string key) external view returns (string) {
        return attributes[key];
    }
}

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_TokenMetadata {
    TestTokenMetadata metadata;
    User user1;
    User user2;
    address owner;
    string[] emptyArray;
    string[] singleImage;
    string[] multipleImages;
    string[] singleFile;
    string[] multipleFiles;
    string[] singleFileName;
    string[] multipleFileNames;

    function beforeAll() {
        owner = address(this);
        user1 = new User();
        user2 = new User();
        
        // Initialize test arrays
        singleImage = ["https://example.com/image1.jpg"];
        multipleImages = ["https://example.com/image1.jpg", "https://example.com/image2.png", "https://example.com/image3.gif"];
        singleFile = ["https://example.com/file1.pdf"];
        multipleFiles = ["https://example.com/file1.pdf", "https://example.com/file2.doc", "https://example.com/file3.txt"];
        singleFileName = ["Document1.pdf"];
        multipleFileNames = ["Document1.pdf", "Document2.doc", "Document3.txt"];
    }

    function beforeEach() {
        // Create a fresh metadata instance for each test
        metadata = new TestTokenMetadata("Initial Description", emptyArray, emptyArray, emptyArray, owner);
    }

    // ============ CONSTRUCTOR TESTS ============

    function it_metadata_sets_initial_description() {
        require(keccak256(metadata.getDescription()) == keccak256("Initial Description"), "Initial description not set correctly");
    }

    function it_metadata_sets_initial_empty_arrays() {
        string[] memory images = metadata.getImages();
        string[] memory files = metadata.getFiles();
        string[] memory fileNames = metadata.getFileNames();
        
        require(images.length == 0, "Initial images array should be empty");
        require(files.length == 0, "Initial files array should be empty");
        require(fileNames.length == 0, "Initial fileNames array should be empty");
    }

    function it_metadata_sets_initial_arrays_with_data() {
        TestTokenMetadata metadataWithData = new TestTokenMetadata(
            "Test Description",
            multipleImages,
            multipleFiles,
            multipleFileNames,
            owner
        );
        
        require(keccak256(metadataWithData.getDescription()) == keccak256("Test Description"), "Description not set correctly");
        
        string[] memory images = metadataWithData.getImages();
        string[] memory files = metadataWithData.getFiles();
        string[] memory fileNames = metadataWithData.getFileNames();
        
        require(images.length == 3, "Images array length should be 3");
        require(files.length == 3, "Files array length should be 3");
        require(fileNames.length == 3, "FileNames array length should be 3");
        
        require(keccak256(images[0]) == keccak256("https://example.com/image1.jpg"), "First image not set correctly");
        require(keccak256(images[1]) == keccak256("https://example.com/image2.png"), "Second image not set correctly");
        require(keccak256(images[2]) == keccak256("https://example.com/image3.gif"), "Third image not set correctly");
        
        require(keccak256(files[0]) == keccak256("https://example.com/file1.pdf"), "First file not set correctly");
        require(keccak256(files[1]) == keccak256("https://example.com/file2.doc"), "Second file not set correctly");
        require(keccak256(files[2]) == keccak256("https://example.com/file3.txt"), "Third file not set correctly");
        
        require(keccak256(fileNames[0]) == keccak256("Document1.pdf"), "First fileName not set correctly");
        require(keccak256(fileNames[1]) == keccak256("Document2.doc"), "Second fileName not set correctly");
        require(keccak256(fileNames[2]) == keccak256("Document3.txt"), "Third fileName not set correctly");
    }

    // ============ METADATA SETTING TESTS ============

    function it_metadata_can_set_metadata() {
        string newDescription = "Updated Description";
        string[] memory newImages = ["https://new.com/image1.jpg", "https://new.com/image2.png"];
        string[] memory newFiles = ["https://new.com/file1.pdf"];
        string[] memory newFileNames = ["NewDocument.pdf"];
        
        metadata.setMetadata(newDescription, newImages, newFiles, newFileNames);
        
        require(keccak256(metadata.getDescription()) == keccak256(newDescription), "Description not updated correctly");
        
        string[] memory images = metadata.getImages();
        string[] memory files = metadata.getFiles();
        string[] memory fileNames = metadata.getFileNames();
        
        require(images.length == 2, "Images array length should be 2");
        require(files.length == 1, "Files array length should be 1");
        require(fileNames.length == 1, "FileNames array length should be 1");
        
        require(keccak256(images[0]) == keccak256("https://new.com/image1.jpg"), "First new image not set correctly");
        require(keccak256(images[1]) == keccak256("https://new.com/image2.png"), "Second new image not set correctly");
        require(keccak256(files[0]) == keccak256("https://new.com/file1.pdf"), "New file not set correctly");
        require(keccak256(fileNames[0]) == keccak256("NewDocument.pdf"), "New fileName not set correctly");
    }

    function it_metadata_can_set_metadata_to_empty_arrays() {
        string newDescription = "Empty Arrays Description";
        string[] memory emptyImages;
        string[] memory emptyFiles;
        string[] memory emptyFileNames;
        
        metadata.setMetadata(newDescription, emptyImages, emptyFiles, emptyFileNames);
        
        require(keccak256(metadata.getDescription()) == keccak256(newDescription), "Description not updated correctly");
        
        string[] memory images = metadata.getImages();
        string[] memory files = metadata.getFiles();
        string[] memory fileNames = metadata.getFileNames();
        
        require(images.length == 0, "Images array should be empty");
        require(files.length == 0, "Files array should be empty");
        require(fileNames.length == 0, "FileNames array should be empty");
    }

    function it_metadata_can_set_metadata_multiple_times() {
        // First update
        metadata.setMetadata("First Update", singleImage, singleFile, singleFileName);
        require(keccak256(metadata.getDescription()) == keccak256("First Update"), "First update failed");
        
        // Second update
        metadata.setMetadata("Second Update", multipleImages, multipleFiles, multipleFileNames);
        require(keccak256(metadata.getDescription()) == keccak256("Second Update"), "Second update failed");
        
        // Third update
        metadata.setMetadata("Third Update", emptyArray, emptyArray, emptyArray);
        require(keccak256(metadata.getDescription()) == keccak256("Third Update"), "Third update failed");
        
        string[] memory images = metadata.getImages();
        require(images.length == 0, "Images should be empty after third update");
    }

    function it_metadata_reverts_set_metadata_by_non_owner() {
        bool reverted = false;
        try {
            user1.do(address(metadata), "setMetadata", "Unauthorized Description", emptyArray, emptyArray, emptyArray);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when non-owner tries to set metadata");
    }

    // ============ ATTRIBUTES TESTS ============

    function it_metadata_can_set_attributes() {
        metadata.setAttribute("category", "utility");
        metadata.setAttribute("version", "1.0.0");
        metadata.setAttribute("author", "Test Author");
        
        require(keccak256(metadata.getAttribute("category")) == keccak256("utility"), "Category attribute not set correctly");
        require(keccak256(metadata.getAttribute("version")) == keccak256("1.0.0"), "Version attribute not set correctly");
        require(keccak256(metadata.getAttribute("author")) == keccak256("Test Author"), "Author attribute not set correctly");
    }

    function it_metadata_can_update_attributes() {
        metadata.setAttribute("category", "utility");
        require(keccak256(metadata.getAttribute("category")) == keccak256("utility"), "Initial category not set");
        
        metadata.setAttribute("category", "governance");
        require(keccak256(metadata.getAttribute("category")) == keccak256("governance"), "Category not updated correctly");
    }

    function it_metadata_can_set_empty_attribute_values() {
        metadata.setAttribute("empty_key", "");
        require(keccak256(metadata.getAttribute("empty_key")) == keccak256(""), "Empty attribute value not set correctly");
    }

    function it_metadata_can_set_large_attribute_values() {
        string memory largeValue = "This is a very long attribute value that contains multiple words and should be stored correctly in the mapping without any issues or truncation problems";
        metadata.setAttribute("large_value", largeValue);
        require(keccak256(metadata.getAttribute("large_value")) == keccak256(largeValue), "Large attribute value not set correctly");
    }

    function it_metadata_can_set_special_character_attributes() {
        metadata.setAttribute("special_chars", "!@#$%^&*()_+-=[]{}|;':\",./<>?");
        metadata.setAttribute("unicode", "🚀💰🎯");
        metadata.setAttribute("numbers", "1234567890");
        
        require(keccak256(metadata.getAttribute("special_chars")) == keccak256("!@#$%^&*()_+-=[]{}|;':\",./<>?"), "Special characters not set correctly");
        require(keccak256(metadata.getAttribute("unicode")) == keccak256("🚀💰🎯"), "Unicode not set correctly");
        require(keccak256(metadata.getAttribute("numbers")) == keccak256("1234567890"), "Numbers not set correctly");
    }

    function it_metadata_returns_empty_string_for_nonexistent_attributes() {
        string memory value = metadata.getAttribute("nonexistent");
        require(keccak256(value) == keccak256(""), "Nonexistent attribute should return empty string");
    }

    function it_metadata_reverts_set_attribute_by_non_owner() {
        bool reverted = false;
        try {
            user1.do(address(metadata), "setAttribute", "category", "utility");
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when non-owner tries to set attribute");
    }

    // ============ ARRAY HANDLING TESTS ============

    function it_metadata_handles_single_element_arrays() {
        string[] memory singleImage = ["https://single.com/image.jpg"];
        string[] memory singleFile = ["https://single.com/file.pdf"];
        string[] memory singleFileName = ["SingleFile.pdf"];
        
        metadata.setMetadata("Single Elements", singleImage, singleFile, singleFileName);
        
        string[] memory images = metadata.getImages();
        string[] memory files = metadata.getFiles();
        string[] memory fileNames = metadata.getFileNames();
        
        require(images.length == 1, "Single image array length should be 1");
        require(files.length == 1, "Single file array length should be 1");
        require(fileNames.length == 1, "Single fileName array length should be 1");
        
        require(keccak256(images[0]) == keccak256("https://single.com/image.jpg"), "Single image not set correctly");
        require(keccak256(files[0]) == keccak256("https://single.com/file.pdf"), "Single file not set correctly");
        require(keccak256(fileNames[0]) == keccak256("SingleFile.pdf"), "Single fileName not set correctly");
    }

    function it_metadata_handles_large_arrays() {
        string[] memory largeImages;
        string[] memory largeFiles;
        string[] memory largeFileNames;
        
        // Create arrays with 10 elements each
        for (uint i = 0; i < 10; i++) {
            largeImages.push("https://example.com/image" + string(i) + ".jpg");
            largeFiles.push("https://example.com/file" + string(i) + ".pdf");
            largeFileNames.push("File" + string(i) + ".pdf");
        }
        
        metadata.setMetadata("Large Arrays", largeImages, largeFiles, largeFileNames);
        
        string[] memory images = metadata.getImages();
        string[] memory files = metadata.getFiles();
        string[] memory fileNames = metadata.getFileNames();
        
        require(images.length == 10, "Large images array length should be 10");
        require(files.length == 10, "Large files array length should be 10");
        require(fileNames.length == 10, "Large fileNames array length should be 10");
        
        // Check first and last elements
        require(keccak256(images[0]) == keccak256("https://example.com/image0.jpg"), "First large image not set correctly");
        require(keccak256(images[9]) == keccak256("https://example.com/image9.jpg"), "Last large image not set correctly");
        require(keccak256(files[0]) == keccak256("https://example.com/file0.pdf"), "First large file not set correctly");
        require(keccak256(files[9]) == keccak256("https://example.com/file9.pdf"), "Last large file not set correctly");
        require(keccak256(fileNames[0]) == keccak256("File0.pdf"), "First large fileName not set correctly");
        require(keccak256(fileNames[9]) == keccak256("File9.pdf"), "Last large fileName not set correctly");
    }

    function it_metadata_handles_arrays_with_special_characters() {
        string[] memory specialImages = ["https://example.com/image with spaces.jpg", "https://example.com/image-with-dashes.png", "https://example.com/image_with_underscores.gif"];
        string[] memory specialFiles = ["https://example.com/file with spaces.pdf", "https://example.com/file-with-dashes.doc"];
        string[] memory specialFileNames = ["File with spaces.pdf", "File-with-dashes.doc"];
        
        metadata.setMetadata("Special Characters", specialImages, specialFiles, specialFileNames);
        
        string[] memory images = metadata.getImages();
        string[] memory files = metadata.getFiles();
        string[] memory fileNames = metadata.getFileNames();
        
        require(images.length == 3, "Special images array length should be 3");
        require(files.length == 2, "Special files array length should be 2");
        require(fileNames.length == 2, "Special fileNames array length should be 2");
        
        require(keccak256(images[0]) == keccak256("https://example.com/image with spaces.jpg"), "Special image with spaces not set correctly");
        require(keccak256(images[1]) == keccak256("https://example.com/image-with-dashes.png"), "Special image with dashes not set correctly");
        require(keccak256(images[2]) == keccak256("https://example.com/image_with_underscores.gif"), "Special image with underscores not set correctly");
    }

    // ============ EDGE CASES AND STRESS TESTS ============

    function it_metadata_handles_empty_strings() {
        metadata.setMetadata("", emptyArray, emptyArray, emptyArray);
        require(keccak256(metadata.getDescription()) == keccak256(""), "Empty description not set correctly");
        
        metadata.setAttribute("empty_key", "");
        require(keccak256(metadata.getAttribute("empty_key")) == keccak256(""), "Empty attribute not set correctly");
    }

    function it_metadata_handles_very_long_strings() {
        string memory longDescription = "This is an extremely long description that contains many words and should be stored correctly without any truncation or overflow issues. It includes multiple sentences and various punctuation marks to test the robustness of the string storage mechanism in the contract.";
        
        metadata.setMetadata(longDescription, emptyArray, emptyArray, emptyArray);
        require(keccak256(metadata.getDescription()) == keccak256(longDescription), "Long description not set correctly");
        
        string memory longAttribute = "This is a very long attribute value that should be stored correctly in the mapping without any issues or truncation problems. It contains multiple words and various characters to test the robustness of the attribute storage system.";
        
        metadata.setAttribute("long_attribute", longAttribute);
        require(keccak256(metadata.getAttribute("long_attribute")) == keccak256(longAttribute), "Long attribute not set correctly");
    }

    function it_metadata_handles_unicode_and_emojis() {
        string memory unicodeDescription = "Description with unicode: 🚀💰🎯 and special chars: ñáéíóú";
        string[] memory unicodeImages = ["https://example.com/🚀.jpg", "https://example.com/💰.png"];
        string[] memory unicodeFiles = ["https://example.com/🎯.pdf"];
        string[] memory unicodeFileNames = ["🚀💰🎯.pdf"];
        
        metadata.setMetadata(unicodeDescription, unicodeImages, unicodeFiles, unicodeFileNames);
        
        require(keccak256(metadata.getDescription()) == keccak256(unicodeDescription), "Unicode description not set correctly");
        
        string[] memory images = metadata.getImages();
        require(keccak256(images[0]) == keccak256("https://example.com/🚀.jpg"), "Unicode image not set correctly");
        require(keccak256(images[1]) == keccak256("https://example.com/💰.png"), "Unicode image 2 not set correctly");
        
        metadata.setAttribute("emoji", "🚀💰🎯");
        require(keccak256(metadata.getAttribute("emoji")) == keccak256("🚀💰🎯"), "Emoji attribute not set correctly");
    }

    function it_metadata_handles_numeric_strings() {
        metadata.setAttribute("number_string", "1234567890");
        metadata.setAttribute("decimal_string", "123.456");
        metadata.setAttribute("negative_string", "-123");
        
        require(keccak256(metadata.getAttribute("number_string")) == keccak256("1234567890"), "Number string not set correctly");
        require(keccak256(metadata.getAttribute("decimal_string")) == keccak256("123.456"), "Decimal string not set correctly");
        require(keccak256(metadata.getAttribute("negative_string")) == keccak256("-123"), "Negative string not set correctly");
    }

    // ============ ACCESS CONTROL TESTS ============

    function it_metadata_enforces_owner_only_access_for_metadata() {
        bool reverted = false;
        try {
            user1.do(address(metadata), "setMetadata", "Unauthorized", emptyArray, emptyArray, emptyArray);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when non-owner tries to set metadata");
        
        bool reverted2 = false;
        try {
            user2.do(address(metadata), "setMetadata", "Also Unauthorized", emptyArray, emptyArray, emptyArray);
        } catch {
            reverted2 = true;
        }
        require(reverted2, "Should revert when another non-owner tries to set metadata");
    }

    function it_metadata_enforces_owner_only_access_for_attributes() {
        bool reverted = false;
        try {
            user1.do(address(metadata), "setAttribute", "key", "value");
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when non-owner tries to set attribute");
        
        bool reverted2 = false;
        try {
            user2.do(address(metadata), "setAttribute", "another_key", "another_value");
        } catch {
            reverted2 = true;
        }
        require(reverted2, "Should revert when another non-owner tries to set attribute");
    }

    // ============ COMPLEX SCENARIOS ============

    function it_metadata_handles_mixed_metadata_and_attributes() {
        // Set metadata
        metadata.setMetadata("Mixed Test", multipleImages, multipleFiles, multipleFileNames);
        
        // Set multiple attributes
        metadata.setAttribute("category", "test");
        metadata.setAttribute("version", "2.0.0");
        metadata.setAttribute("status", "active");
        metadata.setAttribute("tags", "test,metadata,attributes");
        
        // Verify metadata
        require(keccak256(metadata.getDescription()) == keccak256("Mixed Test"), "Mixed description not set correctly");
        string[] memory images = metadata.getImages();
        require(images.length == 3, "Mixed images array length should be 3");
        
        // Verify attributes
        require(keccak256(metadata.getAttribute("category")) == keccak256("test"), "Mixed category not set correctly");
        require(keccak256(metadata.getAttribute("version")) == keccak256("2.0.0"), "Mixed version not set correctly");
        require(keccak256(metadata.getAttribute("status")) == keccak256("active"), "Mixed status not set correctly");
        require(keccak256(metadata.getAttribute("tags")) == keccak256("test,metadata,attributes"), "Mixed tags not set correctly");
    }

    function it_metadata_handles_metadata_updates_with_attribute_persistence() {
        // Set initial metadata and attributes
        metadata.setMetadata("Initial", singleImage, singleFile, singleFileName);
        metadata.setAttribute("persistent", "value");
        metadata.setAttribute("version", "1.0.0");
        
        // Update metadata
        metadata.setMetadata("Updated", multipleImages, multipleFiles, multipleFileNames);
        
        // Verify metadata changed
        require(keccak256(metadata.getDescription()) == keccak256("Updated"), "Description should be updated");
        string[] memory images = metadata.getImages();
        require(images.length == 3, "Images should be updated");
        
        // Verify attributes persisted
        require(keccak256(metadata.getAttribute("persistent")) == keccak256("value"), "Persistent attribute should remain");
        require(keccak256(metadata.getAttribute("version")) == keccak256("1.0.0"), "Version attribute should remain");
    }

    function it_metadata_handles_attribute_updates_with_metadata_persistence() {
        // Set initial metadata and attributes
        metadata.setMetadata("Persistent Description", multipleImages, multipleFiles, multipleFileNames);
        metadata.setAttribute("changeable", "initial");
        
        // Update attributes
        metadata.setAttribute("changeable", "updated");
        metadata.setAttribute("new_attribute", "new_value");
        
        // Verify attributes changed
        require(keccak256(metadata.getAttribute("changeable")) == keccak256("updated"), "Changeable attribute should be updated");
        require(keccak256(metadata.getAttribute("new_attribute")) == keccak256("new_value"), "New attribute should be set");
        
        // Verify metadata persisted
        require(keccak256(metadata.getDescription()) == keccak256("Persistent Description"), "Description should persist");
        string[] memory images = metadata.getImages();
        require(images.length == 3, "Images should persist");
    }

    // ============ PERFORMANCE AND GAS TESTS ============

    function it_metadata_handles_rapid_metadata_changes() {
        for (uint i = 0; i < 5; i++) {
            string memory desc = "Description " + string(i);
            string[] memory img = ["https://example.com/image" + string(i) + ".jpg"];
            string[] memory file = ["https://example.com/file" + string(i) + ".pdf"];
            string[] memory fileName = ["File" + string(i) + ".pdf"];
            
            metadata.setMetadata(desc, img, file, fileName);
            require(keccak256(metadata.getDescription()) == keccak256(desc), "Rapid change " + string(i) + " failed");
        }
    }

    function it_metadata_handles_rapid_attribute_changes() {
        for (uint i = 0; i < 10; i++) {
            string memory key = "key" + string(i);
            string memory value = "value" + string(i);
            
            metadata.setAttribute(key, value);
            require(keccak256(metadata.getAttribute(key)) == keccak256(value), "Rapid attribute change " + string(i) + " failed");
        }
    }

    function it_metadata_handles_large_number_of_attributes() {
        for (uint i = 0; i < 20; i++) {
            string memory key = "attribute_" + string(i);
            string memory value = "This is attribute value number " + string(i) + " with some additional text to make it longer";
            
            metadata.setAttribute(key, value);
        }
        
        // Verify some attributes
        require(keccak256(metadata.getAttribute("attribute_0")) == keccak256("This is attribute value number 0 with some additional text to make it longer"), "First attribute not set correctly");
        require(keccak256(metadata.getAttribute("attribute_19")) == keccak256("This is attribute value number 19 with some additional text to make it longer"), "Last attribute not set correctly");
        require(keccak256(metadata.getAttribute("attribute_10")) == keccak256("This is attribute value number 10 with some additional text to make it longer"), "Middle attribute not set correctly");
    }
}
