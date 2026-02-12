import { gatherSignals } from './server/youtube.js';
async function main() {
  console.log('Starting gatherSignals...');
  const start = Date.now();
  try {
    const signals = await gatherSignals('https://www.youtube.com/watch?v=aircAruvnKk');
    console.log(`Done in ${Date.now() - start}ms`);
    console.log('transcript:', !!signals.transcript);
    console.log('oembed:', !!signals.oembed);
    console.log('metadata:', !!signals.metadata);
    console.log('comments:', signals.comments.length);
    console.log('missing:', signals.missing);
  } catch (e) {
    console.error(`Failed in ${Date.now() - start}ms:`, e);
  }
}
main();
