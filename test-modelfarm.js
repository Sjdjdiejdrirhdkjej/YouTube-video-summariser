#!/usr/bin/env node

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

console.log('=== Replit AI Model Farm Integration Test ===\n');

if (!apiKey || apiKey === 'your_api_key_here') {
  console.error('❌ AI_INTEGRATIONS_OPENAI_API_KEY is not set or not configured');
  console.log('\nTo set up the Model Farm integration:');
  console.log('1. Go to the Integrations panel in Replit');
  console.log('2. Enable "OpenAI AI Integration"');
  console.log('3. The API key and base URL will be automatically set');
  process.exit(1);
}

if (!baseURL) {
  console.error('❌ AI_INTEGRATIONS_OPENAI_BASE_URL is not set');
  process.exit(1);
}

console.log('✅ Environment variables configured:');
console.log(`   - API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 5)}`);
console.log(`   - Base URL: ${baseURL}\n`);

const openai = new OpenAI({
  apiKey: apiKey,
  baseURL: baseURL,
});

console.log('Test 1: Listing available models...');
try {
  const models = await openai.models.list();
  console.log(`✅ Found ${models.data.length} available models:`);
  models.data.slice(0, 5).forEach(model => {
    console.log(`   - ${model.id}`);
  });
  if (models.data.length > 5) {
    console.log(`   ... and ${models.data.length - 5} more`);
  }
  console.log('');
} catch (error) {
  console.error('❌ Failed to list models:', error.message);
}

console.log('Test 2: Testing chat completion with gpt-5.1...');
try {
  const response = await openai.chat.completions.create({
    model: 'gpt-5.1',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Say "Hello from Replit AI Model Farm!"' },
    ],
    max_completion_tokens: 50,
  });

  const content = response.choices[0]?.message?.content || 'No content';
  console.log(`✅ Chat completion successful:`);
  console.log(`   Response: ${content}\n`);
} catch (error) {
  console.error('❌ Chat completion failed:', error.message);
  console.log(`   Details: ${JSON.stringify(error, null, 2).substring(0, 200)}...\n`);
}

console.log('Test 3: Testing streaming chat completion...');
try {
  const stream = await openai.chat.completions.create({
    model: 'gpt-5.1',
    messages: [
      { role: 'user', content: 'Count from 1 to 5' },
    ],
    stream: true,
    max_completion_tokens: 50,
  });

  let fullResponse = '';
  console.log('   Streaming:');

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      process.stdout.write(content);
      fullResponse += content;
    }
  }

  console.log('\n✅ Streaming chat completion successful!\n');
} catch (error) {
  console.error('❌ Streaming chat completion failed:', error.message);
  console.log(`   Details: ${JSON.stringify(error, null, 2).substring(0, 200)}...\n`);
}

console.log('=== Test Complete ===');
