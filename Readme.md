# Weather MCP Server

A serverless weather information service built on the Model Context Protocol (MCP) that runs as a Fleek edge function. This service provides weather alerts and forecasts using the National Weather Service (NWS) API.

## Features

- **Weather Alerts**: Get active weather alerts for any US state
- **Weather Forecasts**: Get detailed weather forecasts for any US location by coordinates
- **MCP Integration**: Use these weather tools through any MCP-compatible client

## Installation

### Prerequisites

- Node.js v18 or newer
- npm or yarn
- A Fleek account for deployment

### Getting Started

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

## Deployment

### Deploy to Fleek

1. Make sure you have the Fleek CLI installed:

   ```bash
   npm install -g @fleek/cli
   ```

2. Login to your Fleek account:

   ```bash
   fleek login
   ```

3. Deploy the function:
   ```bash
   fleek functions deploy
   ```

## Using the Weather MCP Server

The Weather MCP Server implements two main tools:

### 1. Get Weather Alerts

Retrieve active weather alerts for any US state.

**Parameters:**

- `state`: Two-letter state code (e.g., CA, NY, TX)

**Example:**

```json
{
  "type": "tool_call",
  "name": "get-alerts",
  "parameters": {
    "state": "CA"
  }
}
```

### 2. Get Weather Forecast

Retrieve weather forecasts for any US location by coordinates.

**Parameters:**

- `latitude`: Latitude of the location (-90 to 90)
- `longitude`: Longitude of the location (-180 to 180)

**Example:**

```json
{
  "type": "tool_call",
  "name": "get-forecast",
  "parameters": {
    "latitude": 39.7456,
    "longitude": -75.5466
  }
}
```

## API Endpoints

The function exposes several endpoints:

- `GET /sse`: Establish a Server-Sent Events connection
- `POST /messages?connectionId={id}`: Send messages to the MCP server
- `GET /poll?connectionId={id}`: Poll for message responses

### Connection Flow

1. **Connect to the SSE endpoint:**

   ```
   GET /sse
   ```

   This returns a `connectionId` in the SSE stream.

2. **Send a tool request:**

   ```
   POST /messages?connectionId={your_connection_id}
   Content-Type: application/json

   {
     "type": "tool_call",
     "name": "get-forecast",
     "parameters": {
       "latitude": 39.7456,
       "longitude": -75.5466
     }
   }
   ```

3. **Poll for responses:**
   ```
   GET /poll?connectionId={your_connection_id}
   ```
   This returns any pending messages as SSE events.

## Example: Get Weather for Delaware

To get the weather forecast for Wilmington, Delaware:

1. Connect to SSE and get a connection ID
2. Send a request with these coordinates:
   - Latitude: 39.7456 (Wilmington, DE)
   - Longitude: -75.5466 (Wilmington, DE)

## Limitations

- Only works for US locations (NWS API limitation)
- In-memory state management (connections may be lost between function invocations)
- Edge function timeout limits may affect long-running connections

## Development

### Local Testing

Test the API using curl or Postman:

   ```bash
   # Connect to SSE
   curl -N http://localhost:8787/sse

   # Send a request (in another terminal)
   curl -X POST http://localhost:8787/messages?connectionId=YOUR_CONNECTION_ID \
     -H "Content-Type: application/json" \
     -d '{"type":"tool_call","name":"get-forecast","parameters":{"latitude":39.7456,"longitude":-75.5466}}'

   # Poll for messages
   curl -N http://localhost:8787/poll?connectionId=YOUR_CONNECTION_ID
   ```

## MCP Integration

This server implements the Model Context Protocol, allowing it to be used with any MCP-compatible client. See the MCP documentation for more details.
