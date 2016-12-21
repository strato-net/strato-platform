contract StringStorage {
	string storedData;

	function set(string value) {
		storedData = value;
	}

	function get() returns (string) {
		return storedData;
	}
}