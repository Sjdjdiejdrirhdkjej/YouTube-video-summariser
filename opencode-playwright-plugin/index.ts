import { tool } from "@opencode-ai/plugin/tool";
import { chromium, type Browser, type Page, type BrowserContext } from "playwright";

let browserInstance: Browser | null = null;
let contextInstance: BrowserContext | null = null;
let pageInstance: Page | null = null;

async function ensureBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless: true });
    contextInstance = await browserInstance.newContext();
    pageInstance = await contextInstance.newPage();
  }
  return { browser: browserInstance!, context: contextInstance!, page: pageInstance! };
}

/**
 * Clean up browser resources
 */
async function cleanupBrowser() {
  if (pageInstance) await pageInstance.close().catch(() => {});
  if (contextInstance) await contextInstance.close().catch(() => {});
  if (browserInstance) await browserInstance.close().catch(() => {});
  pageInstance = null;
  contextInstance = null;
  browserInstance = null;
}

/**
 * Navigate to a URL
 */
const playwright_navigate = tool({
  description: "Navigate the browser to a specified URL. Returns the page title and URL.",
  args: {
    url: tool.schema.string().url().describe("The URL to navigate to"),
    waitUntil: tool.schema
      .enum(["load", "domcontentloaded", "networkidle"] as const)
      .optional()
      .describe("When to consider navigation succeeded (default: 'load')"),
  },
  async execute(args: any) {
    const { page } = await ensureBrowser();
    await page.goto(args.url, {
      waitUntil: args.waitUntil || "load",
      timeout: 30000,
    });

    const title = await page.title();
    const currentUrl = page.url();

    return `Navigated to ${currentUrl}\nPage title: ${title}`;
  },
});

/**
 * Click an element
 */
const playwright_click = tool({
  description: "Click an element on the page. Supports CSS selectors, text selectors, and test IDs.",
  args: {
    selector: tool.schema
      .string()
      .describe("Selector for the element to click (CSS selector, text, or test id)"),
    waitForSelector: tool.schema
      .boolean()
      .default(true)
      .describe("Wait for the element to be visible before clicking (default: true)"),
  },
  async execute(args: any) {
    const { page } = await ensureBrowser();

    if (args.waitForSelector) {
      await page.waitForSelector(args.selector, { state: "visible", timeout: 5000 });
    }

    await page.click(args.selector, { timeout: 5000 });

    return `Clicked element: ${args.selector}`;
  },
});

/**
 * Fill an input field
 */
const playwright_fill = tool({
  description: "Fill an input field with text. Supports text inputs, textareas, and contenteditable elements.",
  args: {
    selector: tool.schema.string().describe("Selector for the input element"),
    value: tool.schema.string().describe("The text to fill into the input"),
  },
  async execute(args: any) {
    const { page } = await ensureBrowser();
    await page.fill(args.selector, args.value);

    return `Filled ${args.selector} with: ${args.value}`;
  },
});

/**
 * Take a screenshot
 */
const playwright_screenshot = tool({
  description: "Take a screenshot of the current page or a specific element. Returns the screenshot path.",
  args: {
    path: tool.schema.string().optional().describe("Path to save the screenshot (relative to project directory)"),
    selector: tool.schema.string().optional().describe("Selector to capture a specific element instead of full page"),
    fullPage: tool.schema.boolean().default(false).describe("Capture the full page, not just the viewport (default: false)"),
  },
  async execute(args: any, context: any) {
    const { page } = await ensureBrowser();

    const screenshotPath = args.path || `${context.directory}/screenshot-${Date.now()}.png`;

    if (args.selector) {
      await page.locator(args.selector).screenshot({ path: screenshotPath });
    } else {
      await page.screenshot({ path: screenshotPath, fullPage: args.fullPage });
    }

    return `Screenshot saved to: ${screenshotPath}`;
  },
});

/**
 * Execute JavaScript on the page
 */
const playwright_evaluate = tool({
  description: "Execute JavaScript code in the browser context and return the result.",
  args: {
    script: tool.schema.string().describe("JavaScript code to execute (can be a function or expression)"),
  },
  async execute(args: any) {
    const { page } = await ensureBrowser();
    const result = await page.evaluate(args.script);

    return `Result: ${JSON.stringify(result, null, 2)}`;
  },
});

/**
 * Get text content from an element
 */
const playwright_text = tool({
  description: "Extract text content from one or more elements on the page.",
  args: {
    selector: tool.schema.string().optional().describe("Selector for the element (default: entire page body)"),
    all: tool.schema.boolean().default(false).describe("Get text from all matching elements (default: false)"),
  },
  async execute(args: any) {
    const { page } = await ensureBrowser();

    const selector = args.selector || "body";

    if (args.all) {
      const elements = await page.locator(selector).all();
      const texts = await Promise.all(elements.map((el: any) => el.textContent()));
      return texts.filter(Boolean).join("\n---\n");
    } else {
      const text = await page.locator(selector).textContent();
      return text || "No text found";
    }
  },
});

/**
 * Select an option from a dropdown
 */
const playwright_select = tool({
  description: "Select an option from a select dropdown by value, label, or index.",
  args: {
    selector: tool.schema.string().describe("Selector for the select element"),
    value: tool.schema.string().optional().describe("Option value to select"),
    label: tool.schema.string().optional().describe("Option label/text to select"),
    index: tool.schema.number().optional().describe("Option index to select (0-based)"),
  },
  async execute(args: any) {
    const { page } = await ensureBrowser();

    if (args.value) {
      await page.selectOption(args.selector, args.value);
    } else if (args.label) {
      await page.selectOption(args.selector, { label: args.label });
    } else if (args.index !== undefined) {
      await page.selectOption(args.selector, { index: args.index });
    } else {
      throw new Error("Must specify one of: value, label, or index");
    }

    return `Selected option from ${args.selector}`;
  },
});

/**
 * Wait for an element or condition
 */
const playwright_wait_for = tool({
  description: "Wait for an element, condition, or timeout to occur.",
  args: {
    selector: tool.schema.string().optional().describe("Wait for this element to be attached/visible"),
    timeout: tool.schema.number().optional().default(5000).describe("Timeout in milliseconds (default: 5000)"),
    state: tool.schema
      .enum(["attached", "detached", "visible", "hidden"] as const)
      .default("visible")
      .describe("Element state to wait for (default: 'visible')"),
  },
  async execute(args: any) {
    const { page } = await ensureBrowser();

    if (args.selector) {
      await page.waitForSelector(args.selector, {
        state: args.state,
        timeout: args.timeout,
      });
      return `Element ${args.selector} reached state: ${args.state}`;
    } else {
      await page.waitForTimeout(args.timeout);
      return `Waited ${args.timeout}ms`;
    }
  },
});

/**
 * Close the browser
 */
const playwright_close = tool({
  description: "Close the browser and cleanup all Playwright resources. Call this when done with automation.",
  args: {},
  async execute() {
    await cleanupBrowser();
    return "Browser closed";
  },
});

/**
 * Get current page info (title, URL, etc.)
 */
const playwright_info = tool({
  description: "Get information about the current page: title, URL, viewport size, etc.",
  args: {},
  async execute() {
    const { page } = await ensureBrowser();

    const title = await page.title();
    const url = page.url();
    const viewport = page.viewportSize();

    return `Page Info:
- Title: ${title}
- URL: ${url}
- Viewport: ${viewport?.width}x${viewport?.height}`;
  },
});

/**
 * Opencode Playwright Plugin
 *
 * Exports the plugin for use in Opencode
 */
export const OpencodePlaywrightPlugin = async () => {
  return {
    tool: {
      playwright_navigate,
      playwright_click,
      playwright_fill,
      playwright_screenshot,
      playwright_evaluate,
      playwright_text,
      playwright_select,
      playwright_wait_for,
      playwright_close,
      playwright_info,
    },
  };
};

/**
 * Cleanup on process exit
 */
process.on("exit", cleanupBrowser);
process.on("SIGINT", () => {
  cleanupBrowser().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  cleanupBrowser().then(() => process.exit(0));
});
