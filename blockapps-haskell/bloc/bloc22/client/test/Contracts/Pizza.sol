contract Pizza {
  /**
   * It is helpful to think of
   * smart contracts as state machine.
   * In this example:
   * State 1: Deploy new smart pizza contract
   * State 2: Set pizza details; price and topping
   * State 3: Smart contract is funned by buyer
   * State 4: Pizza is being delivered
   * State 5: Pizzed has arrived and buyer has indicated the satisfaction level
   */

  address seller;
  address buyer;
  address oracle;
  address satisfactionOracle;

  uint pizzaPrice;
  uint guarantee;
  uint eth = 1000000000000000000;

  string pizzaToppings;
  string stateMessage;
  string message;
  uint stateInt;

  function Pizza() {
    seller = msg.sender;

    stateMessage = "Uploaded pizza smart contract";
    stateInt = 1;

    message = stateMessage;
    //eth = 1000000000000000000; // for some reason constructor isn't called
  }

  /**
   * Set the details specific to this pizza
   */
  function setUpPizzaDetails(uint price, string topping) {
    stateMessage = "Pizza details set";
    message = stateMessage;
    stateInt = 2;
    pizzaPrice = price;
    pizzaToppings = topping;
  }

  /**
   * Fund the pizza contract to accept it
   */
  function buyerAcceptsPizzaContract() {
    if (msg.value >=  eth * pizzaPrice) {
      buyer = msg.sender;
      stateInt = 3;
      stateMessage = "Buyer funded pizza contract";
      message = stateMessage;
    } else {
      msg.sender.send(msg.value);
      message = "Contract not funded. Refunded money";
    }
  }

  /**
   *
   */
  function pizzaAccepted() {
    if (msg.sender == buyer) {
      stateInt = 4;
      stateMessage = "Pizza Delivered";
      message = stateMessage;
      seller.send(this.balance);
    } else {
      message = "Only buyer can accept";
    }
  }

  /**
   * To rating for the pizza to release funds
   */
  function rateSatisfaction(bool isHappy) {
    stateInt = 5;
    if (isHappy) {
      stateMessage = "The buyer was happy.";
      seller.send(this.balance);
    } else {
      stateMessage = "The buyer requested refund.";
      buyer.send(this.balance);
    }
  }

}
