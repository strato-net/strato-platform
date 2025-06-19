const createUserArgs = function (accountAddress, uid, role = 1) {
  const username = `User_${uid}`;

  // function User(address _account, string _username)
  const args = {
    account: accountAddress,
    username: username,
  };
  return args;
};

export { createUserArgs };
