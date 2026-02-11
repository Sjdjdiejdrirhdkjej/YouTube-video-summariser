# Opencode Playwright Plugin

A native Opencode plugin providing Playwright browser automation tools. This plugin integrates directly with Opencode's tool system for efficient browser automation.

## Installation

1. Configure the plugin in your `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./path/to/opencode-playwright-plugin"
  ]
}
```

2. Or install it as an npm package (if published):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-playwright-plugin@latest"
  ]
}
```

## Usage

After installation, the following Playwright tools will be available in Opencode:

### Tools

- **`playwright_navigate`**: Navigate the browser to a URL
  - `url` (required): The URL to navigate to
  - `waitUntil` (optional): "load" | "domcontentloaded" | "networkidle"

- **`playwright_click`**: Click an element on the page
  - `selector` (required): CSS selector, text selector, or test ID
  - `waitForSelector` (optional): Wait for element to be visible

- **`playwright_fill`**: Fill an input field with text
  - `selector` (required): Selector for the input element
  - `value` (required): Text to fill into the input

- **`playwright_screenshot`**: Take a screenshot
  - `path` (optional): Path to save the screenshot
  - `selector` (optional): Selector to capture specific element
  - `fullPage` (optional): Capture full page instead of viewport

- **`playwright_evaluate`**: Execute JavaScript in the browser
  - `script` (required): JavaScript code to execute

- **`playwright_text`**: Extract text content from elements
  - `selector` (optional): Selector for the element (default: body)
  - `all` (optional): Get text from all matching elements

- **`playwright_select`**: Select an option from a dropdown
  - `selector` (required): Selector for the select element
  - `value`, `label`, or `index` (one required): Option selection method

- **`playwright_wait_for`**: Wait for elements/conditions
  - `selector` (optional): Wait for this element
  - `timeout` (optional): Timeout in milliseconds (default: 5000)
  - `state` (optional): "attached" | "detached" | "visible" | "hidden"

- **`playwright_info`**: Get current page information
  - No args required

- **`playwright_close`**: Close the browser
  - No args required

## Example Usage

```typescript
// Navigate to a page
await opencode.callTool("playwright_navigate", {
  url: "https://example.com"
});

// Fill a search box
await opencode.callTool("playwright_fill", {
  selector: "#search-input",
  value: "Playwright"
});

// Click the search button
await opencode.callTool("playwright_click", {
  selector: "button[type='submit']"
});

// Take a screenshot
await opencode.callTool("playwright_screenshot", {
  path: "screenshot.png"
});

// Clean up
await opencode.callTool("playwright_close", {});
```

## Development

```bash
# Build the plugin
npm run build

# Watch for changes
npm run dev
```

## License

MIT
