const Airtable = require("airtable");

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

async function logReferral(data) {
  try {
    const createdRecords = await base(AIRTABLE_TABLE_NAME).create([
      {
        fields: data,
      },
    ]);

    return createdRecords;

  } catch (error) {
    throw error;
  }
}

export default logReferral;
