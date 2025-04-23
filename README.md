# AWS PostgreSQL MCP Server

This is a Model Context Protocol (MCP) server designed to provide read-only access to an AWS PostgreSQL database. It exposes a single tool, `query`, allowing MCP clients (like Cline or Claude Desktop) to execute safe, read-only SQL queries.

## Features

*   **Read-Only Access:** Securely queries your AWS PostgreSQL database without allowing data modification.
*   **SQL Validation:** Automatically checks if submitted queries are read-only (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN) and rejects potentially harmful commands (INSERT, UPDATE, DELETE, etc.).
*   **Stdio Transport:** Communicates with MCP clients using standard input/output (stdio), the default transport mechanism.
*   **Configurable:** Uses a PostgreSQL connection string passed as a command-line argument.

## Prerequisites

*   Node.js and pnpm installed.
*   Access credentials for your AWS PostgreSQL database.

## Installation & Setup

1.  **Clone the repository (if applicable):**
    ```bash
    git clone https://github.com/T1nker-1220/aws-postgress-mcp-server.git
    cd aws-postgress-mcp-server
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

Add the following entry within the `mcpServers` object:

```json
{
  "mcpServers": {
    // ... other servers ...

    "aws-postgres-mcp-server": {
      "command": "node",
      "args": [
        // Use the full, absolute path to the built index.js file
        "C:\\Users\\NATH\\Documents\\Cline\\MCP\\aws-postgress-mcp-server\\build\\index.js",
        // PostgreSQL connection string as the last argument
        "postgresql://minrights:2Knowthyself33!@minrights-pg.chq86qgigowu.us-east-1.rds.amazonaws.com:5432/minrights"
      ],
      "transportType": "stdio", // Explicitly using stdio
      "disabled": false,        // Ensure the server is enabled
      "autoApprove": []         // Configure auto-approval if desired (e.g., ["query"])
    }

    // ... other servers ...
  }
}
```

**Important:** The PostgreSQL connection string is passed directly as the last argument in the `args` array. The format is: `postgresql://username:password@host:port/database`

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

You can run the server directly for testing purposes by passing the PostgreSQL connection string as a command-line argument:

```bash
# Run the built server with a connection string
pnpm start "postgresql://username:password@host:port/database"
# or
node build/index.js "postgresql://username:password@host:port/database"

# Example with actual values
node build/index.js "postgresql://minrights:2Knowthyself33!@minrights-pg.chq86qgigowu.us-east-1.rds.amazonaws.com:5432/minrights"
```

## Running with `npx` (Requires Publishing to npm)

While `npx` can execute packages directly from GitHub (`npx github:T1nker-1220/aws-postgress-mcp-server`), MCP clients (like Cline, Cursor, Windsurf) are typically configured to use `npx` with packages published on the **npm registry**.

To enable running via `npx <package-name>` within MCP client configurations, you first need to publish this package to npm:

1.  **Publish the package to npm:**
    *   Ensure your `package.json` is correctly configured (name, version, description, main file, etc.). The name should be unique on npm. Using your GitHub username as a scope is common: `@t1nker-1220/aws-postgres-mcp-server`.
    *   Add a `bin` field to `package.json` pointing to the executable script (`build/index.js`) - *this is already done*.
        ```json
        "bin": {
          "aws-pg-mcp": "./build/index.js" // Example command name if installed globally
        }
        ```
    *   Make sure the first line of `src/index.ts` is `#!/usr/bin/env node` (which it already is).
    *   Build the project (`pnpm run build`).
    *   Log in to npm (`npm login`).
    *   Publish the package (`npm publish --access public` if using a scope like `@t1nker-1220/`).

2.  **Configure MCP Client:**
    Once published (e.g., as `@t1nker-1220/aws-postgres-mcp-server`), you can configure clients like Cline, Cursor, or Windsurf:
    ```json
    "your-server-name": {
      "command": "npx",
      "args": [
        "-y",
        "@t1nker-1220/aws-postgres-mcp-server", // Use the actual published package name
        "postgresql://username:password@host:port/database" // Connection string as the last argument
      ],
      "transportType": "stdio",
      "disabled": false,
      "autoApprove": []
    }
    ```
    
    This is similar to running the server directly with npx:
    ```bash
    npx -y @t1nker-1220/aws-postgres-mcp-server "postgresql://username:password@host:port/database"
    ```

**Note:** The primary way to use this server is through configuration within an MCP client (pointing to the local build path or a published npm package). Direct execution via `npx` (either from npm or GitHub) is mainly for testing or specific use cases outside of standard client integration.

## Compatibility with Registries (e.g., Smithery.ai)

This server adheres to the Model Context Protocol (MCP) specification and communicates via stdio, making it compatible in principle with MCP server registries and platforms like [Smithery.ai](https://smithery.ai/docs).

To list or host this server on such platforms, you will likely need to:
1.  Package the server, typically by publishing it as an npm package (see the `npx` section above). Some platforms might also support Docker images.
2.  Follow the specific registration or deployment instructions provided by the platform (e.g., Smithery.ai).

## Development

*   Run in development mode (watches for changes): `pnpm run dev`
*   Build: `pnpm run build`
