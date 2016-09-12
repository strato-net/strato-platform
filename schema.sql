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

-- use quotes around column names to retain case-sensitivity
CREATE TABLE Sample
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
  "address" text PRIMARY KEY
);

COMMIT;
