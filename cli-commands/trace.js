// cli-commands/trace.js
import { connectToActiveBrowser, timestamp } from './shared.js';

export async function handleTrace(args) {
  const action = args[0];
  const { browser, context } = await connectToActiveBrowser();
  switch (action) {
    case 'start':
      await context.tracing.start({ screenshots: true, snapshots: true });
      console.log('Trace recording started.');
      break;
    case 'stop': {
      const file = args[1] || `trace-${timestamp()}.zip`;
      await context.tracing.stop({ path: file });
      console.log(`Trace saved: ${file}`);
      break;
    }
    default:
      console.error(`Unknown trace command: ${action}`);
      process.exit(1);
  }
  browser.disconnect();
}
