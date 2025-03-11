import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Type definitions for Fleek Functions
interface FleekFunctionParams {
  method: string;
  path: string;
  headers: Record<string, string>;
  query?: Record<string, string>; // Add explicit query parameter support
  body?: any;
}

interface FleekFunctionResponse {
  status?: number;
  headers?: Record<string, string>;
  body: string;
}

// Create our own Transport interface based on MCP SDK requirements
interface Transport {
  start(): Promise<void>;
  close(): Promise<void>;
  send(message: any): Promise<void>;
  receive(): Promise<any>;
  onMessage?(callback: (message: any) => void): void;
}

// Custom SSE connection interface
interface SSEConnection {
  id: string;
  messages: string[];
  lastEventId: number;
}

// Weather API types
interface AlertFeature {
  properties: {
    event?: string;
    areaDesc?: string;
    severity?: string;
    status?: string;
    headline?: string;
  };
}

interface ForecastPeriod {
  name?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
}

interface AlertsResponse {
  features: AlertFeature[];
}

interface PointsResponse {
  properties: {
    forecast?: string;
  };
}

interface ForecastResponse {
  properties: {
    periods: ForecastPeriod[];
  };
}

// Constants
const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";

// Create server instance
const server = new McpServer({
  name: "weather",
  version: "1.0.0",
});

// Helper function for making NWS API requests
async function makeNWSRequest<T>(url: string): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/geo+json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making NWS request:", error);
    return null;
  }
}

// Format alert data
function formatAlert(feature: AlertFeature): string {
  const props = feature.properties;
  return [
    `Event: ${props.event || "Unknown"}`,
    `Area: ${props.areaDesc || "Unknown"}`,
    `Severity: ${props.severity || "Unknown"}`,
    `Status: ${props.status || "Unknown"}`,
    `Headline: ${props.headline || "No headline"}`,
    "---",
  ].join("\n");
}

// Register weather tools
server.tool(
  "get-alerts",
  "Get weather alerts for a state",
  {
    state: z.string().length(2).describe("Two-letter state code (e.g. CA, NY)"),
  },
  async ({ state }) => {
    const stateCode = state.toUpperCase();
    const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
    const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl);

    if (!alertsData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve alerts data",
          },
        ],
      };
    }

    const features = alertsData.features || [];
    if (features.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No active alerts for ${stateCode}`,
          },
        ],
      };
    }

    const formattedAlerts = features.map(formatAlert);
    const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join(
      "\n"
    )}`;

    return {
      content: [
        {
          type: "text",
          text: alertsText,
        },
      ],
    };
  }
);

server.tool(
  "get-forecast",
  "Get weather forecast for a location",
  {
    latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude of the location"),
  },
  async ({ latitude, longitude }) => {
    // Get grid point data
    const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(
      4
    )},${longitude.toFixed(4)}`;
    const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);

    if (!pointsData) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
          },
        ],
      };
    }

    const forecastUrl = pointsData.properties?.forecast;
    if (!forecastUrl) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to get forecast URL from grid point data",
          },
        ],
      };
    }

    // Get forecast data
    const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
    if (!forecastData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve forecast data",
          },
        ],
      };
    }

    const periods = forecastData.properties?.periods || [];
    if (periods.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No forecast periods available",
          },
        ],
      };
    }

    // Format forecast periods
    const formattedForecast = periods.map((period: ForecastPeriod) =>
      [
        `${period.name || "Unknown"}:`,
        `Temperature: ${period.temperature || "Unknown"}°${
          period.temperatureUnit || "F"
        }`,
        `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
        `${period.shortForecast || "No forecast available"}`,
        "---",
      ].join("\n")
    );

    const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join(
      "\n"
    )}`;

    return {
      content: [
        {
          type: "text",
          text: forecastText,
        },
      ],
    };
  }
);

// -------------------- FLEEK FUNCTION IMPLEMENTATION --------------------

// Simple in-memory message queue for SSE
const connections: SSEConnection[] = [];
const messageQueue: any[] = [];

// Custom transport for Fleek Functions that implements the required Transport interface
class FleekTransport implements Transport {
  private onMessageCallback: ((message: any) => void) | null = null;
  private isConnected = false;

  // Required Transport interface methods
  async start(): Promise<void> {
    this.isConnected = true;
    console.log("FleekTransport started");
  }

  async close(): Promise<void> {
    this.isConnected = false;
    console.log("FleekTransport closed");
  }

  async send(message: any): Promise<void> {
    if (!this.isConnected) {
      console.warn("Transport not connected, message not sent");
      return;
    }

    // Add message to queue for all active connections
    messageQueue.push(message);

    // Send to all active connections
    connections.forEach((conn) => {
      try {
        conn.messages.push(JSON.stringify(message));
      } catch (error) {
        console.error("Error sending message:", error);
      }
    });
  }

  async receive(): Promise<any> {
    // This is a placeholder - in Fleek Function context
    // messages are received via HTTP endpoints
    return null;
  }

  // Method to handle incoming messages from HTTP endpoint
  async handleIncomingMessage(message: any): Promise<void> {
    if (this.onMessageCallback) {
      this.onMessageCallback(message);
    }
  }

  // Set message handler
  onMessage(callback: (message: any) => void): void {
    this.onMessageCallback = callback;
  }
}

// Create a transport instance
const transport = new FleekTransport();

// Connect server to transport
let serverInitialized = false;

// Initialize server (done only once)
async function initServer(): Promise<void> {
  if (!serverInitialized) {
    try {
      // If TypeScript still complains, use a type assertion as a last resort
      await server.connect(transport);
      serverInitialized = true;
      console.log("MCP Server initialized");
    } catch (error) {
      console.error("Failed to initialize server:", error);
    }
  }
}

// Helper function to extract connectionId from different sources
function getConnectionId(params: FleekFunctionParams): string | null {
  // Check multiple potential sources for the connectionId

  // 1. Try query parameter in the URL path
  if (params.path && params.path.includes("connectionId=")) {
    const match = params.path.match(/[?&]connectionId=([^&]+)/);
    if (match) return match[1];
  }

  // 2. Try query object if provided by Fleek
  if (params.query && params.query.connectionId) {
    return params.query.connectionId;
  }

  // 3. Try body if it's a POST request with JSON
  if (
    params.body &&
    typeof params.body === "object" &&
    params.body.connectionId
  ) {
    return params.body.connectionId;
  }

  // 4. Try as URL parameters using URL constructor (this was the original approach)
  try {
    const url = new URL(`http://example.com${params.path}`);
    const connId = url.searchParams.get("connectionId");
    if (connId) return connId;
  } catch (e) {
    console.error("Error parsing URL:", e);
  }

  // No connection ID found
  return null;
}

// Function to handle SSE connections
function handleSSE(params: FleekFunctionParams): FleekFunctionResponse {
  const connectionId = Date.now().toString();

  // Set up connection object with message queue
  const connection: SSEConnection = {
    id: connectionId,
    messages: [],
    lastEventId: 0,
  };

  // Add to active connections
  connections.push(connection);

  // Log connection for debugging
  console.log(`New connection established: ${connectionId}`);
  console.log(`Total connections: ${connections.length}`);

  // Format SSE response
  let sseResponse = [
    "Content-Type: text/event-stream",
    "Cache-Control: no-cache",
    "Connection: keep-alive",
    "\n",
  ].join("\n");

  // Add connection established message
  sseResponse += `event: connected\ndata: {"connectionId":"${connectionId}"}\n\n`;

  // Return initial response
  return {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    body: sseResponse,
  };
}

// Function to get queued messages for a connection
function getSSEMessages(
  connectionId: string | null,
  params: FleekFunctionParams
): FleekFunctionResponse {
  // Try to get connectionId from multiple sources if not provided directly
  if (!connectionId) {
    connectionId = getConnectionId(params);
  }

  if (!connectionId) {
    console.error("Missing connectionId parameter in poll request");
    console.log("Path:", params.path);
    console.log("Query:", params.query);

    return {
      status: 400,
      body: JSON.stringify({
        error: "Missing connectionId parameter",
        path: params.path,
        query: params.query,
      }),
    };
  }

  const connection = connections.find((conn) => conn.id === connectionId);
  if (!connection) {
    console.error(`Connection not found: ${connectionId}`);
    console.log(
      `Available connections: ${connections.map((c) => c.id).join(", ")}`
    );

    return {
      status: 404,
      body: JSON.stringify({
        error: "Connection not found",
        connectionId,
        availableConnections: connections.length,
      }),
    };
  }

  // Get queued messages
  const messages = connection.messages;
  connection.messages = [];

  // Format as SSE messages
  let response = "";
  messages.forEach((msg, index) => {
    const eventId = connection.lastEventId + index + 1;
    response += `id: ${eventId}\nevent: message\ndata: ${msg}\n\n`;
  });

  connection.lastEventId += messages.length;

  return {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    body: response || "event: ping\ndata: {}\n\n", // Send empty ping if no messages
  };
}

// Function to process incoming messages
async function handleMessage(
  body: any,
  connectionId: string | null,
  params: FleekFunctionParams
): Promise<FleekFunctionResponse> {
  // Try to get connectionId from multiple sources if not provided directly
  if (!connectionId) {
    connectionId = getConnectionId(params);
  }

  if (!connectionId) {
    console.error("Missing connectionId parameter in message request");
    console.log("Path:", params.path);
    console.log(
      "Body:",
      typeof body === "object" ? JSON.stringify(body) : body
    );

    return {
      status: 400,
      body: JSON.stringify({
        error: "Missing connectionId parameter",
        details:
          "Please include connectionId in the URL query parameter or request body",
        path: params.path,
      }),
    };
  }

  try {
    const connection = connections.find((conn) => conn.id === connectionId);
    if (!connection) {
      console.error(`Connection not found: ${connectionId}`);
      console.log(
        `Available connections: ${connections.map((c) => c.id).join(", ")}`
      );

      return {
        status: 404,
        body: JSON.stringify({
          error: "Connection not found",
          connectionId,
          availableConnections: connections.length,
        }),
      };
    }

    console.log(`Processing message for connection: ${connectionId}`);
    console.log(`Message body:`, body);

    // Extract the actual message content from the body if needed
    const messageContent = body.type && body.name ? body : body.message || body;

    // Process message with the MCP server
    await transport.handleIncomingMessage(messageContent);

    return {
      status: 200,
      body: JSON.stringify({
        status: "received",
        connectionId,
      }),
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Error handling message:", error);
    return {
      status: 500,
      body: JSON.stringify({
        error: errorMessage,
        connectionId,
      }),
    };
  }
}

// Log all requests for debugging
function logRequest(params: FleekFunctionParams): void {
  console.log(`Request: ${params.method} ${params.path}`);
  console.log(`Headers: ${JSON.stringify(params.headers)}`);
  if (params.body) {
    console.log(
      `Body: ${
        typeof params.body === "object"
          ? JSON.stringify(params.body)
          : params.body
      }`
    );
  }
}

// Main entry point for Fleek Function
export const main = async (
  params: FleekFunctionParams
): Promise<FleekFunctionResponse> => {
  // Log request for debugging
  logRequest(params);

  // Initialize the server if not already done
  await initServer();

  const { method, path } = params;

  // Extract connectionId using our helper function
  const connectionId = getConnectionId(params);
  console.log(`Extracted connectionId: ${connectionId || "none"}`);

  // Route request based on path and method
  if (path === "/sse" || path.startsWith("/sse?")) {
    return handleSSE(params);
  }

  if (
    (path === "/messages" || path.startsWith("/messages?")) &&
    method === "POST"
  ) {
    return await handleMessage(params.body, connectionId, params);
  }

  if ((path === "/poll" || path.startsWith("/poll?")) && method === "GET") {
    return getSSEMessages(connectionId, params);
  }

  // Default route to provide help info
  return {
    status: 200,
    body: JSON.stringify(
      {
        message: "Weather MCP Server",
        endpoints: {
          "/sse": "Connect via SSE",
          "/messages?connectionId={id}": "Send messages (POST)",
          "/poll?connectionId={id}": "Poll for messages (GET)",
        },
        debug: {
          path,
          method,
          connectionId: connectionId || "none",
          activeConnections: connections.length,
        },
      },
      null,
      2
    ),
  };
};
