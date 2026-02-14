#!/usr/bin/env node
/**
 * Puter.js v2 Authentication Setup Script
 * 
 * Run this script once to obtain an authentication token.
 * It will open a browser for you to log in to Puter.com.
 * 
 * Usage:
 *   node setup-puter-auth.js
 * 
 * After successful authentication, the token will be:
 * 1. Printed to console
 * 2. Saved to .puter-token file (for reference)
 * 3. Instructions given for adding to .env
 */

import { getAuthToken } from '@heyputer/puter.js/src/init.cjs';
import fs from 'fs';
import path from 'path';

async function setupPuterAuth() {
  console.log('🚀 Starting Puter.js v2 authentication setup...');
  console.log('📋 This script will:');
  console.log('  1. Open a browser for Puter.com login');
  console.log('  2. Obtain an authentication token');
  console.log('  3. Save the token for server use');
  console.log('');
  console.log('⚠️  Make sure you have a Puter.com account.');
  console.log('   If you don\'t have one, you\'ll need to create one.');
  console.log('');

  try {
    console.log('🔄 Requesting authentication token...');
    console.log('   A browser window will open for login.');
    
    const authToken = await getAuthToken();
    
    if (!authToken) {
      throw new Error('No authentication token received');
    }
    
    console.log('✅ Authentication successful!');
    console.log('');
    console.log('🔐 Your Puter.js authentication token:');
    console.log(`   ${authToken}`);
    console.log('');
    
    // Save token to file for reference
    const tokenFile = path.join(process.cwd(), '.puter-token');
    fs.writeFileSync(tokenFile, authToken, 'utf8');
    console.log(`📁 Token saved to: ${tokenFile}`);
    console.log('');
    
    console.log('📝 Next steps:');
    console.log('   1. Add this token to your .env file:');
    console.log(`      PUTER_AUTH_TOKEN=${authToken}`);
    console.log('   2. Remove .puter-token file (optional, contains sensitive token)');
    console.log('   3. Restart your server');
    console.log('');
    console.log('💡 For production:');
    console.log('   - Store token in secure environment variable');
    console.log('   - Rotate token periodically');
    console.log('   - Monitor usage via puter.auth.getMonthlyUsage()');
    
    return authToken;
  } catch (error) {
    console.error('❌ Authentication failed:');
    console.error(`   ${error.message}`);
    console.error('');
    console.error('Possible issues:');
    console.error('   - Browser blocked or not available');
    console.error('   - Network connectivity issues');
    console.error('   - Puter.com service unavailable');
    process.exit(1);
  }
}

// Run if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupPuterAuth();
}

export default setupPuterAuth;