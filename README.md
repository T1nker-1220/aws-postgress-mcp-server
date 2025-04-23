# AWS PostgreSQL MCP Server

This is a Model Context Protocol (MCP) server designed to provide read-only access to an AWS PostgreSQL database. It exposes a single tool, `query`, allowing MCP clients (like Cline or Claude Desktop) to execute safe, read-only SQL queries.

## Features

*   **Read-Only Access:** Securely queries your AWS PostgreSQL database without allowing data modification.
*   **SQL Validation:** Automatically checks if submitted queries are read-only (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN) and rejects potentially harmful commands (INSERT, UPDATE, DELETE, etc.).
*   **Stdio Transport:** Communicates with MCP clients using standard input/output (stdio), the default transport mechanism.
*   **Configurable:** Uses environment variables for database connection details.

## Prerequisites

*   Node.js and pnpm installed.
*   Access credentials for your AWS PostgreSQL database.

## Installation & Setup

1.  **Clone the repository (if applicable):**
    ```bash
    git clone <repository-url>
    cd aws-postgres-mcp-server
    ```
2.  **Install dependencies:**
    ```bash
    pnpm install
    ```
3.  **Build the server:**
    ```bash
    pnpm run build
    ```
    This compiles the TypeScript code into JavaScript in the `build/` directory.

## Configuration for MCP Clients (e.g., Cline)

To use this server with an MCP client, you need to add its configuration to the client's settings file. For Cline, this is typically located at: `c:\Users\<YourUsername>\AppData\Roaming\Windsurf\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`

Add the following entry within the `mcpServers` object (adjust the path to `build/index.js` if necessary):

```json
{
  "mcpServers": {
    // ... other servers ...

    "aws-postgres-mcp-server": {
      "command": "node",
      "args": [
        // Use the full, absolute path to the built index.js file
        "C:\\path\\to\\your\\aws-postgress-mcp-server\\build\\index.js" 
      ],
      "env": {
        "DB_HOST": "your-db-host.rds.amazonaws.com",
        "DB_PORT": "5432",
        "DB_NAME": "your_database_name",
        "DB_USER": "your_database_user",
        "DB_PASSWORD": "your_database_password"
      },
      "transportType": "stdio", // Explicitly using stdio
      "disabled": false,        // Ensure the server is enabled
      "autoApprove": []         // Configure auto-approval if desired (e.g., ["query"])
    }

    // ... other servers ...
  }
}
```

**Important:** Replace the placeholder values in the `env` object with your actual AWS PostgreSQL credentials.

## Usage

Once configured, the MCP client will automatically start the server. You can then use the `query` tool:

**Tool:** `query`
**Description:** Run a read-only SQL query against the AWS PostgreSQL database.
**Input:**
```json
{
  "sql": "YOUR_READ_ONLY_SQL_QUERY"
}
```

**Example (using Cline's `use_mcp_tool`):**

```xml
<use_mcp_tool>
  <server_name>aws-postgres-mcp-server</server_name>
  <tool_name>query</tool_name>
  <arguments>
  {
    "sql": "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' LIMIT 5;"
  }
  </arguments>
</use_mcp_tool>
```

The server will return the query results as a JSON string or an error message if the query fails or is not read-only.

## Running Standalone (for testing)

You can run the server directly for testing purposes, but it requires the environment variables to be set:

```bash
# Set environment variables (example for PowerShell)
$env:DB_HOST="your-db-host..."
$env:DB_PORT="5432"
$env:DB_NAME="your_db_name"
$env:DB_USER="your_db_user"
$env:DB_PASSWORD="your_db_password"

# Run the built server
pnpm start 
# or
node build/index.js 
```

## Running with `npx` (Requires Publishing)

To run this server using `npx`, you would typically need to:

1.  **Publish the package to npm:**
    *   Ensure your `package.json` is correctly configured (name, version, description, main file, etc.).
    *   Add a `bin` field to `package.json` pointing to the executable script (`build/index.js`):
        ```json
        "bin": {
          "aws-postgres-mcp-server": "./build/index.js"
        }
        ```
    *   Make sure the first line of `src/index.ts` is `#!/usr/bin/env node` (which it already is).
    *   Build the project (`pnpm run build`).
    *   Log in to npm (`npm login`).
    *   Publish the package (`npm publish`).

2.  **Run with `npx`:**
    Once published, users could potentially run it directly (though this isn't the standard way to run MCP servers, which are usually managed by the client):
    ```bash
    # Set environment variables first
    npx aws-postgres-mcp-server 
    ```

**Note:** The primary way to use this server is through configuration within an MCP client, not typically via direct `npx` execution for regular use. Publishing is only necessary if you intend to distribute it as a standalone package.

## Development

*   Run in development mode (watches for changes): `pnpm run dev`
*   Build: `pnpm run build`
