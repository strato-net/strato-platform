declare module '../events/bridgeIn' {
  export interface BridgeInEvent {
    type: string;
    data: {
      transactionHash: string;
      from: string;
      to: string;
      value: string;
    };
  }

  export function bridgeIn(event: BridgeInEvent): Promise<void>;
}

declare module '../events/bridgeOut' {
  export interface BridgeOutEvent {
    type: string;
    data: {
      transactionHash: string;
      from: string;
      to: string;
      value: string;
    };
  }

  export function bridgeOut(event: BridgeOutEvent): Promise<void>;
}