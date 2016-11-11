BEGIN;

  -- { currentVendor: 'BHP',
  --   fsm: 'e7d3ba3139c7ce9f97770da804210290156acd01',
  --   sampleType: 'Ditch Cuttings Dry',
  --   currentState: 'PLANNED',
  --   currentLocationType: 'locationtype1',
  --   trackingNumbers: [],
  --   startDepthFeet: '200',
  --   buid: '13',
  --   wellName: 'well1',
  --   endDepthFeet: '300',
  --   startDepthMeter: '61',
  --   _owner: '31f294f522d1a81f6271fec4285d46f2dc19aea2',
  --   endDepthMeter: '91',
  --   address: '4a91a35302904a9a7a73c57f668d5e2e4ac038b4' } 

-- { startDepthFeet: { atBytes: 224, bytes: 32, type: 'Int' },
--   startDepthMeter: { bytes: 32, atBytes: 288, type: 'Int' },
--   currentVendor: { atBytes: 192, dynamic: true, type: 'String' },
--   orgIds:
--    { dynamic: true,
--      type: 'Mapping',
--      atBytes: 384,
--      value: { dynamic: true, type: 'String' },
--      key: { type: 'String', dynamic: true } },
--   endDepthFeet: { atBytes: 256, bytes: 32, type: 'Int' },
--   currentLocationType: { type: 'String', dynamic: true, atBytes: 160 },
--   currentState: { atBytes: 52, typedef: 'SampleStateEnum' },
--   _owner: { type: 'Address', atBytes: 0 },
--   buid: { bytes: 32, atBytes: 64, type: 'Int' },
--   sampleType: { atBytes: 128, type: 'String', dynamic: true },
--   endDepthMeter: { type: 'Int', bytes: 32, atBytes: 320 },
--   wellName: { atBytes: 96, type: 'String', dynamic: true },
--   trackingNumbers:
--    { entry: { type: 'String', dynamic: true },
--      atBytes: 352,
--      type: 'Array',
--      dynamic: true },
--   fsm: { atBytes: 32, typedef: 'SampleFsm' } }

-- { currentVendor: 'text',
--   fsm: 'text',
--   sampleType: 'text',
--   currentState: 'text',
--   currentLocationType: 'text',
--   trackingNumbers: 'json',
--   startDepthFeet: 'integer',
--   buid: 'integer',
--   wellName: 'text',
--   endDepthFeet: 'integer',
--   startDepthMeter: 'integer',
--   _owner: 'text PRIMARY KEY',
--   endDepthMeter: 'integer' }


CREATE TABLE <codeHash>
(
  "currentVendor" text,
  "fsm" text,
  "sampleType" text,
  "currentState" text,
  "currentLocationType" text,
  "trackingNumbers" json,
  "startDepthFeet" integer,
  "buid" integer,
  "wellName" text,
  "endDepthFeet" integer,
  "startDepthMeter" integer,
  "_owner" text,
  "endDepthMeter" integer,
  "address" text PRIMARY KEY -- maybe name differently
); 

-------------------------

CREATE TABLE "contract" -- no contract can have this name because of solidity
(
  "codeHash" text PRIMARY KEY,
  "name" text
);

-- use quotes around column names to retain case-sensitivity
-- CREATE TABLE "Sample"
-- (
--   "currentVendor" text,
--   "fsm" text,
--   "sampleType" text,
--   "currentState" text,
--   "currentLocationType" text,
--   "trackingNumbers" json,
--   "startDepthFeet" integer,
--   "buid" integer,
--   "wellName" text,
--   "endDepthFeet" integer,
--   "startDepthMeter" integer,
--   "_owner" text,
--   "endDepthMeter" integer,
--   "address" text PRIMARY KEY,
--   "codeHash" text
-- );

-- COMMIT;


COMMIT;
