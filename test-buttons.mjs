import { chromium } from 'playwright';
import { execSync } from 'child_process';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Intercept console logs to see if there are any errors
  page.on('console', msg => console.log(`[CONSOLE] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[ERROR] ${err}`));
  
  // Go to the app
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  console.log('✅ App loaded');
  
  // Wait for the app to initialize
  await page.waitForTimeout(2000);
  
  // Check if buttons exist
  const readyBtn = await page.$('#lobbyReadyButton');
  const startBtn = await page.$('#startGameButton');
  const leaveBtn = await page.$('#lobbyLeaveButton');
  const copyBtn = await page.$('#lobbyCopyButton');
  
  console.log(`Ready button exists: ${!!readyBtn}`);
  console.log(`Start button exists: ${!!startBtn}`);
  console.log(`Leave button exists: ${!!leaveBtn}`);
  console.log(`Copy button exists: ${!!copyBtn}`);
  
  // Check if they're inside .lobby-overlay
  const lobbyOverlay = await page.$('#lobbyOverlay');
  console.log(`Lobby overlay exists: ${!!lobbyOverlay}`);
  
  // Take a screenshot of the initial state
  await page.screenshot({ path: 'initial-state.png' });
  console.log('📸 Screenshot: initial-state.png');
  
  // Try clicking Ready button and observe
  if (readyBtn) {
    console.log('\n🔍 Clicking Ready button...');
    await readyBtn.click();
    await page.waitForTimeout(100);
    console.log('Ready button clicked');
    await page.screenshot({ path: 'after-ready-click.png' });
  }
  
  // Try clicking Start Game button
  if (startBtn) {
    console.log('\n🔍 Clicking Start Game button...');
    await startBtn.click();
    await page.waitForTimeout(100);
    console.log('Start Game button clicked');
  }
  
  // Try clicking Leave button
  if (leaveBtn) {
    console.log('\n🔍 Clicking Leave button...');
    await leaveBtn.click();
    await page.waitForTimeout(100);
    console.log('Leave button clicked');
  }
  
  // Try clicking Copy button
  if (copyBtn) {
    console.log('\n🔍 Clicking Copy button...');
    await copyBtn.click();
    await page.waitForTimeout(100);
    console.log('Copy button clicked');
  }
  
  // Check if audio context was created by evaluating JS
  const audioContextInfo = await page.evaluate(() => {
    return {
      audioContext: typeof AudioContext !== 'undefined',
      webkitAudioContext: typeof webkitAudioContext !== 'undefined',
    };
  });
  console.log('\nAudio API available:', audioContextInfo);
  
  await browser.close();
})();
