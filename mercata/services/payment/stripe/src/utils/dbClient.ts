import { Pool } from 'pg';

// Create a connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'mercata_stripe',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 10, // Maximum number of connections in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Create the pending_sessions table if it doesn't exist
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_sessions (
        session_id VARCHAR(255) PRIMARY KEY,
        token VARCHAR(255) NOT NULL,
        buyer_address VARCHAR(255) NOT NULL,
        token_amount VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_sessions_created_at 
      ON pending_sessions(created_at)
    `);
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Save a pending session to the database
 */
export async function savePendingSession(
  sessionId: string, 
  token: string, 
  buyerAddress: string, 
  tokenAmount: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO pending_sessions (session_id, token, buyer_address, token_amount) 
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id) DO NOTHING`, // Prevent duplicates
      [sessionId, token, buyerAddress, tokenAmount]
    );
  } catch (error) {
    console.error(`Failed to save pending session ${sessionId}:`, error);
    throw error;
  }
}

/**
 * Remove a completed session from the database
 */
export async function removePendingSession(sessionId: string): Promise<void> {
  try {
    const result = await pool.query(
      'DELETE FROM pending_sessions WHERE session_id = $1',
      [sessionId]
    );
    
    if (result.rowCount === 0) {
      console.warn(`Session ${sessionId} was not found in pending_sessions table`);
    }
  } catch (error) {
    console.error(`Failed to remove pending session ${sessionId}:`, error);
    throw error;
  }
}

/**
 * Check if a session is pending (exists in database)
 */
export async function isPendingSession(sessionId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      'SELECT 1 FROM pending_sessions WHERE session_id = $1',
      [sessionId]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error(`Failed to check pending session ${sessionId}:`, error);
    return false; // Assume not pending if we can't check
  }
}

/**
 * Get all pending sessions (for startup recovery)
 */
export async function getAllPendingSessions(): Promise<Array<{
  sessionId: string;
  token: string;
  buyerAddress: string;
  tokenAmount: string;
  createdAt: Date;
}>> {
  try {
    const result = await pool.query(
      'SELECT session_id, token, buyer_address, token_amount, created_at FROM pending_sessions ORDER BY created_at'
    );
    
    return result.rows.map((row: any) => ({
      sessionId: row.session_id,
      token: row.token,
      buyerAddress: row.buyer_address,
      tokenAmount: row.token_amount,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error('Failed to get pending sessions:', error);
    return [];
  }
}

/**
 * Clean up old pending sessions (older than 24 hours)
 */
export async function cleanupOldSessions(): Promise<void> {
  try {
    const result = await pool.query(
      'DELETE FROM pending_sessions WHERE created_at < NOW() - INTERVAL \'24 hours\''
    );
    
    if (result.rowCount && result.rowCount > 0) {
      console.log(`Cleaned up ${result.rowCount} old pending sessions`);
    }
  } catch (error) {
    console.error('Failed to cleanup old sessions:', error);
  }
}

// Initialize database on module load
initializeDatabase().catch(error => {
  console.error('Database initialization failed:', error);
  process.exit(1);
});

// Cleanup old sessions every hour
setInterval(cleanupOldSessions, 60 * 60 * 1000);

export { pool };