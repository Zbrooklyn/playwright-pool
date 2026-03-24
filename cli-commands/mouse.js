// cli-commands/mouse.js
import { connectToActiveBrowser } from './shared.js';

export async function handleMouse(args) {
  const action = args[0];
  const { browser, page } = await connectToActiveBrowser();
  switch (action) {
    case 'move':
      await page.mouse.move(Number(args[1]), Number(args[2]));
      console.log(`Mouse moved to ${args[1]}, ${args[2]}`);
      break;
    case 'click': {
      const button = args.includes('--button') ? args[args.indexOf('--button') + 1] : 'left';
      await page.mouse.click(Number(args[1]), Number(args[2]), { button });
      console.log(`Mouse clicked at ${args[1]}, ${args[2]} (${button})`);
      break;
    }
    case 'drag':
      await page.mouse.move(Number(args[1]), Number(args[2]));
      await page.mouse.down();
      await page.mouse.move(Number(args[3]), Number(args[4]));
      await page.mouse.up();
      console.log(`Mouse dragged from ${args[1]},${args[2]} to ${args[3]},${args[4]}`);
      break;
    default:
      console.error(`Unknown mouse command: ${action}`);
      process.exit(1);
  }
  browser.disconnect();
}
