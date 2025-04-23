#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';

// Get the PostgreSQL connection string from command-line arguments
// Format: postgresql://username:password@host:port/database
const connectionString = process.argv[2];

// Validate that the connection string is provided
if (!connectionString) {
  console.error('Error: PostgreSQL connection string is required as a command-line argument.');
  console.error('Usage: node index.js "postgresql://username:password@host:port/database"');
  console.error('   or: npx @t1nker-1220/aws-postgres-mcp-server "postgresql://username:password@host:port/database"');
  process.exit(1);
}

// Validate that the connection string has the correct format
if (!connectionString.startsWith('postgresql://')) {
  console.error('Error: Invalid PostgreSQL connection string format.');
  console.error('Connection string must start with "postgresql://"');
  process.exit(1);
}

// SSL configuration to handle self-signed certificates
const sslConfig = {
  rejectUnauthorized: false // Disable certificate validation to handle self-signed certificates
};

// Regular expressions for validating read-only SQL queries
const READ_ONLY_PATTERNS = [
  /^\s*SELECT\s/i,
  /^\s*WITH\s/i,
  /^\s*SHOW\s/i,
  /^\s*DESCRIBE\s/i,
  /^\s*EXPLAIN\s/i,
];

const WRITE_PATTERNS = [
  /^\s*INSERT\s/i,
  /^\s*UPDATE\s/i,
  /^\s*DELETE\s/i,
  /^\s*DROP\s/i,
  /^\s*CREATE\s/i,
  /^\s*ALTER\s/i,
  /^\s*TRUNCATE\s/i,
  /^\s*GRANT\s/i,
  /^\s*REVOKE\s/i,
];

/**
 * Validates if a SQL query is read-only
 * @param sql The SQL query to validate
 * @returns true if the query is read-only, false otherwise
 */
function isReadOnlyQuery(sql: string): boolean {
  // Check if the query matches any read-only pattern
  const isReadOnly = READ_ONLY_PATTERNS.some(pattern => pattern.test(sql));
  
  // Check if the query matches any write pattern
  const isWrite = WRITE_PATTERNS.some(pattern => pattern.test(sql));
  
  // A query is read-only if it matches a read-only pattern and doesn't match any write pattern
  return isReadOnly && !isWrite;
}

/**
 * Validates the SQL query arguments
 * @param args The arguments to validate
 * @returns true if the arguments are valid, false otherwise
 */
const isValidQueryArgs = (args: any): args is { sql: string } =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.sql === 'string';

class PostgresServer {
  private server: Server;
  private pool: pg.Pool;

  constructor() {
    // Initialize the MCP server
    this.server = new Server(
      {
        name: 'aws-postgres-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize the PostgreSQL connection pool with the connection string
    this.pool = new pg.Pool({
      connectionString,
      ssl: sslConfig
    });

    // Set up the tool handlers
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.pool.end();
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Sets up the tool handlers for the MCP server
   */
  private setupToolHandlers() {
    // Define the available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'query',
          description: 'Run a read-only SQL query against the AWS PostgreSQL database',
          inputSchema: {
            type: 'object',
            properties: {
              sql: {
                type: 'string',
                description: 'The SQL query to execute (must be read-only)',
              },
            },
            required: ['sql'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'query') {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      // Validate the arguments
      if (!isValidQueryArgs(request.params.arguments)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Invalid query arguments: expected { sql: string }'
        );
      }

      const sql = request.params.arguments.sql;

      // Validate that the query is read-only
      if (!isReadOnlyQuery(sql)) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Only read-only queries are allowed. Your query appears to be a write operation or contains disallowed statements.',
            },
          ],
          isError: true,
        };
      }

      try {
        // Execute the query
        const result = await this.pool.query(sql);
        
        // Format the result as JSON
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                rowCount: result.rowCount,
                rows: result.rows,
                fields: result.fields.map(field => ({
                  name: field.name,
                  dataTypeID: field.dataTypeID,
                })),
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        // Handle database errors
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Database error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Starts the MCP server
   */
  async run() {
    try {
      // Test the database connection
      const client = await this.pool.connect();
      console.error('Successfully connected to the PostgreSQL database');
      client.release();

      // Start the server
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('AWS PostgreSQL MCP server running on stdio');
    } catch (error) {
      console.error('Failed to start the server:', error);
      process.exit(1);
    }
  }
}

// Create and run the server
const server = new PostgresServer();
server.run().catch(console.error);
