# BOULDER: Black Page Issue

## Root Cause

**File**: `src/theme.tsx`, line 22

**Bug**: 
```typescript
localStorage.setItem('theme', JSON.stringify(newTheme));
```

Uses `JSON.stringify()` which wraps the theme value in quotes, storing `"dark"` instead of `dark`.

## Impact Chain

1. **Save time**: Line 22 stores `"dark"` (with quotes)
2. **Read time**: Line 14 reads `"dark"` back as a string
3. **Initialization**: 
   ```typescript
   const storedTheme = localStorage.getItem('theme') as Theme | null;
   // storedTheme = "\"dark\"" (string with quotes)
   const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
   return storedTheme ?? systemTheme;
   ```
4. **Problem**: `storedTheme` is truthy (`"\"dark\""`), so it gets used instead of falling back to `systemTheme`
5. **But wait**: `storedTheme` is `"\"dark\""` NOT `'dark'`, so it doesn't match the Theme type properly
6. **Result**: The theme state becomes corrupted/mismatched, leading to unexpected dark mode application

## Visual Effect

When dark mode is applied (due to the corrupted theme state):
```css
[data-theme='dark'] {
  --color-bg-main: #0a0a0a;  /* Nearly black */
}
```
```css
body {
  background-color: var(--color-bg-main);  /* #0a0a0a on dark */
}
```

**Result**: Page appears black

## Fix

Change line 22 from:
```typescript
localStorage.setItem('theme', JSON.stringify(newTheme));
```

To:
```typescript
localStorage.setItem('theme', newTheme);
```

## Verification Steps

1. Open localStorage (DevTools > Application > Local Storage)
2. Observe current value: likely `"dark"` or `"light"` with quotes
3. Manual test: Delete localStorage entry, refresh page
4. Page should render correctly (light theme on light system, dark on dark system)
5. Toggle theme button should switch properly
6. Reload should persist the chosen theme

## Files Affected

- `src/theme.tsx` line 22 (root cause)
- `src/variables.css` line 24 (dark mode background color definition)
- `src/App.css` line 8 (body background uses the CSS variable)

## Related Code

**src/theme.tsx full context**:
```typescript
const toggleTheme = () => {
  const newTheme = theme === 'light' ? 'dark' : 'light';
  try {
    localStorage.setItem('theme', JSON.stringify(newTheme));  // ← BUG HERE
  } catch (error) {
    console.error('Failed to save theme to localStorage', error);
  }
  setTheme(newTheme);
};
```

**src/theme.tsx initialization**:
```typescript
const [theme, setTheme] = React.useState<Theme>(() => {
  const storedTheme = localStorage.getItem('theme') as Theme | null;
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return storedTheme ?? systemTheme;
});
```

## Priority

**High**: UX breaking bug - users see black page with no content visible depending on their system theme and localStorage state.
