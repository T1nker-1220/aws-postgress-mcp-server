#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Resource,
  ResourceContents,
} from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';

// Database connection configuration from environment variables
const DB_CONFIG = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false, // Disable certificate validation to handle self-signed certificates
  },
};

// Validate that all required environment variables are present
if (!DB_CONFIG.host || !DB_CONFIG.database || !DB_CONFIG.user || !DB_CONFIG.password) {
  throw new Error('Missing required database configuration environment variables');
}

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
        version: '1.1.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {}, // <-- Add this empty object to enable resources
        },
      }
    );

    // Initialize the PostgreSQL connection pool
    this.pool = new pg.Pool(DB_CONFIG);

    // Set up the tool handlers
    this.setupToolHandlers();
    // Set up the resource handlers
    this.setupResourceHandlers(); // <-- Add this call

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
   * Sets up the resource handlers for the MCP server
   */
  private setupResourceHandlers() {
    const dbName = DB_CONFIG.database || 'unknown_db';
    const schemasToExpose = ['minrights', 'public', 'spatial', 'ed_data', 'data', 'ose'];
    const baseUriSchema = `aws-pg://${dbName}/schema`; // URI for schema resources

    // Handler for listing available top-level resources (schemas)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources: Resource[] = schemasToExpose.map(schemaName => ({
        uri: `${baseUriSchema}/${schemaName}`, // URI points to the schema itself
        name: `Schema: ${schemaName}`,
        description: `Browse tables within the ${schemaName} schema of the ${dbName} database.`,
        mimeType: 'application/json', // Indicate that reading returns JSON list of tables
      }));
      return { resources };
    });

    // Handler for reading a specific resource (either a schema or a table)
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      let uri = request.params.uri; // Use 'let' so we can modify it
      // Strip leading '@' if present (added by some clients like Cline)
      if (uri.startsWith('@')) {
        uri = uri.substring(1);
      }

      const schemaUriPrefix = `${baseUriSchema}/`;

      // Check if it's a schema URI (e.g., .../schema/public)
      if (uri.startsWith(schemaUriPrefix) && !uri.includes('/table/')) {
        const schemaName = uri.substring(schemaUriPrefix.length);

        if (schemasToExpose.includes(schemaName)) {
          try {
            // Query for tables within this schema
            const tableQuery = `
              SELECT table_name
              FROM information_schema.tables
              WHERE table_schema = $1
              ORDER BY table_name;
            `;
            const tableResult = await this.pool.query(tableQuery, [schemaName]);

            // Return a list of *table* resources
            const tableResources: Resource[] = tableResult.rows.map(row => {
              const tableName = row.table_name;
              return {
                uri: `${uri}/table/${tableName}`, // Construct table URI
                name: tableName,
                description: `Schema definition for table ${schemaName}.${tableName}`,
                mimeType: 'text/plain', // Content will be table schema
              };
            });

            // MCP allows ReadResource to return multiple Resource definitions
            // We wrap them in a ResourceContents object where the 'resources' field holds the list.
            // A client would interpret this as the content of the schema resource *being* the list of table resources.
            // const contents: ResourceContents[] = [{ uri: uri, resources: tableResources }];
            // return { contents };

            // --- New Approach: Return table list as JSON text --- //
            const tableListJson = JSON.stringify(tableResources, null, 2); // Pretty-print JSON
            const contents: ResourceContents[] = [
              {
                uri: uri, // URI of the schema resource itself
                mimeType: 'application/json',
                text: tableListJson, // Return the list as JSON text
              },
            ];
            return { contents };

          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new McpError(ErrorCode.InternalError, `Failed to list tables for schema ${schemaName}: ${errorMessage}`);
          }
        } else {
          throw new McpError(ErrorCode.InvalidParams, `Schema not exposed: ${schemaName}`);
        }
      }

      // Check if it's a table URI (e.g., .../schema/public/table/users)
      const tableUriPattern = new RegExp(`^${schemaUriPrefix}([^/]+)/table/([^/]+)$`);
      const tableMatch = uri.match(tableUriPattern);

      if (tableMatch) {
        const schemaName = tableMatch[1];
        const tableName = tableMatch[2];

        if (schemasToExpose.includes(schemaName)) {
          try {
            // Query for column definitions of this table
            const columnQuery = `
              SELECT column_name, data_type, is_nullable
              FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = $2
              ORDER BY ordinal_position;
            `;
            const columnResult = await this.pool.query(columnQuery, [schemaName, tableName]);

            if (columnResult.rows.length === 0) {
               throw new McpError(ErrorCode.InvalidParams, `Table not found or no columns: ${schemaName}.${tableName}`);
            }

            // Format the schema information
            let schemaText = `Schema for table: ${schemaName}.${tableName}\n\n`;
            schemaText += columnResult.rows.map(col =>
              `- ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'NULLABLE' : 'NOT NULL'})`
            ).join('\n');

            const contents: ResourceContents[] = [
              {
                uri: uri,
                mimeType: 'text/plain',
                text: schemaText,
              },
            ];
            return { contents };

          } catch (error) {
             if (error instanceof McpError) throw error; // Re-throw known MCP errors
             const errorMessage = error instanceof Error ? error.message : String(error);
            throw new McpError(ErrorCode.InternalError, `Failed to read schema for table ${schemaName}.${tableName}: ${errorMessage}`);
          }
        } else {
           throw new McpError(ErrorCode.InvalidParams, `Schema not exposed: ${schemaName}`);
        }
      }

      // If URI format is not recognized
      throw new McpError(ErrorCode.InvalidParams, `Resource URI not found or format incorrect: ${uri}`);
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
