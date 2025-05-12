---
title: Web UI Design and Implementation
sidebar_position: 11
---

## Web UI Design and Implementation

EagleRank includes a simple Web User Interface primarily for demonstration, testing, and debugging of the feed outputs. This is not an end-user social media UI, but a developer/admin tool and reference implementation for how a tenant app might use EagleRank.

**Technologies:** We use React (with TypeScript) for the frontend, bootstrapped with Create React App or Vite. For styling, we use Tailwind CSS for quick and consistent design. The Web UI communicates with EagleRank's backend via gRPC-Web. We utilize the grpc-web npm package to generate a client from our .proto definitions, allowing the React app to call the gRPC methods directly from the browser. This provides a strongly-typed client and avoids having to craft HTTP requests manually.

**Functionality:** The UI provides:
- **Tenant Switcher:** If multiple tenants are available to the logged-in admin, a dropdown to select the active tenant.
- **Feed Explorer:** An interface to input a User ID (or pick from a list of sample users) and request their feed. On clicking "Load Feed", the app calls the GetFeed API. The response, which is a list of items with scores and metadata, is displayed in a list.
- **Item Details:** For each feed item shown, we display details such as the Item ID, the author, the model score, and possibly the features that went into that score. This might involve an additional API call to fetch the feature values or we could extend the FeedResponse to include some debug info (like top features contribution). For now, a basic implementation might just show item ID and score.
- **Feature Viewer (debug):** A section where you can query the feature store for a given user or item to see what data the system has about them. This could call a debug endpoint in the gateway that reads from the feature store (locked down to admin use). This is very helpful for understanding why the model made certain decisions.
- **Real-time Updates:** The UI can also show real-time event ingestion (for debugging, maybe a stream of events coming in). This might be a stretch goal; alternatively, we just rely on logs for that.

**Layout:** We design a clean dashboard-like interface. For example:
- A header with EagleRank logo/name and environment (dev/prod).
- A sidebar or topbar to choose tenant and perhaps navigate between "Feed Explorer", "Feature Viewer", etc.
- The main content area for each feature. In Feed Explorer, after retrieving a feed, display the list of posts in order. Each item could be a card showing the content (if we have a URL or text snippet) and the score. Since EagleRank itself doesn't store full content, the UI might need to call a content service or simulate content. For demo purposes, we may store dummy content for item IDs (like "Post 42: Hello World") either in a small SQLite or as part of the response. We might augment the Candidate service to return a bit of content info (like a title) so the UI can display something meaningful. This is a bit outside core ranking but helps visualization.

**gRPC-Web Integration:** We deploy an Envoy proxy with the UI (or as part of the backend deployment) so that the React app (served as static files from an S3 or via a Node server) can call the gRPC APIs. The Envoy config maps `/eaglerank.FeedService/GetFeed` etc. to the backend. This was described earlier: the browser sends gRPC-Web (which is essentially POST requests with a protobuf payload) to Envoy, Envoy translates to HTTP/2 to our gateway ([adjoe.io](https://adjoe.io/company/engineer-blog/working-with-grpc-web/)). For development, we can run the React app with a proxy setting that directs /grpc calls to localhost Gateway.

**Security for UI:** We'll likely secure the Web UI with a simple login (even basic auth or Google OAuth) since it's for internal use. Alternatively, the UI can require the user to input an API key to use in calls (which the gateway will verify). For now, assume it's internal enough.

**Local Dev and Deployment:** Locally, the React dev server can proxy API calls to the local gateway. In production, we build the React app to static files. These can be served via a CloudFront + S3 or via a simple Nginx container on Kubernetes. We include appropriate CORS settings or host them under the same domain as the API (to avoid CORS altogether).

**Design Considerations:** We strive for a responsive design that could be shown to stakeholders or recruiters. It will likely be simple text and tables, but we use Tailwind to add spacing, colors, and maybe a dark mode for the code sections. If possible, we might integrate Grafana charts or metric views in the UI as well (or just link to Grafana dashboards) for a holistic "control panel".

**Functional Mockup Description:** Imagine the feed tester UI as a form at the top to enter a User ID and a "Get Feed" button. Below, a table shows each returned item in order: columns like Rank, ItemID, Score, Title. Clicking an item expands to show detailed info (features: e.g., "user_click_rate: 0.8, item_popularity: 0.5, ..."). On the side, you might have a filter to only show certain types of content or a slider to simulate different "algorithms" (which could call the API with different model parameters). The idea is to make feed results transparent.

This Web UI not only aids the single developer in debugging but also serves as a portfolio piece, demonstrating the system's capabilities in an interactive way.

Illustration: Browser-based gRPC-Web calls are proxied via Envoy to EagleRank's gRPC services. The React app uses the grpc-web JS client to communicate with the Feed API (Envoy converts HTTP/1.1 + Protobuf to HTTP/2 gRPC) ([adjoe.io](https://adjoe.io/company/engineer-blog/working-with-grpc-web/)). 