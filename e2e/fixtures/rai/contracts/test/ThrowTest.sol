contract ThrowTest {
	function run(int a){
		if(a >= 0){
			return;
		} else if (a < 0){
			throw;
		}
	}
}