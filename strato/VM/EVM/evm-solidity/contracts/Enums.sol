
contract Enums {

  enum ActionChoices { GoLeft, GoRight, GoStraight, SitStill }

  ActionChoices choice = ActionChoices.GoRight;

  ActionChoices defaultChoice = ActionChoices.GoStraight;

}

