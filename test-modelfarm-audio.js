#!/usr/bin/env node

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

console.log('=== Testing Audio Generation (gpt-audio) ===\n');

const openai = new OpenAI({ apiKey, baseURL });

try {
  const response = await openai.audio.speech.create({
    model: 'gpt-audio',
    input: 'This is a test of the Replit AI Model Farm audio integration.',
    voice: 'alloy',
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(`✅ Audio generation successful: ${buffer.length} bytes`);
  console.log(`   Model: gpt-audio`);
  console.log(`   Voice: alloy`);
  console.log(`   Output size: ${buffer.length} bytes\n`);
} catch (error) {
  console.error('❌ Audio generation failed:', error.message);
  console.log(`   Details: ${JSON.stringify(error, null, 2).substring(0, 200)}\n`);
}

console.log('=== Test Complete ===');
