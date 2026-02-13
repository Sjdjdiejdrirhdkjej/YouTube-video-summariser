import './App.css';
import React from 'react';
import { useTheme } from './theme';
import { ErrorDisplay } from './components/ErrorDisplay';
import LandingPage from './components/LandingPage';
import YTSummarisePage from './components/YTSummarisePage';
import SharedSummary from './components/SharedSummary';
import ChatPage from './components/ChatPage';
import Changelog from './components/Changelog';

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [page, setPage] = React.useState(window.location.pathname);

  React.useEffect(() => {
    const onPopState = () => setPage(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setPage(path);
  };

  // Landing page
  if (page === '/' || page === '') {
    return (
      <>
        <LandingPage onGetStarted={() => navigate('/ytsummarise')} />
        <ErrorDisplay />
      </>
    );
  }

  // Summarization page
  if (page === '/ytsummarise') {
    return (
      <>
        <YTSummarisePage onBack={() => navigate('/')} />
        <ErrorDisplay />
      </>
    );
  }

  // Changelog
  if (page === '/changelog') {
    return (
      <>
        <Changelog onBack={() => navigate('/')} />
        <ErrorDisplay />
      </>
    );
  }

  // Shared summary: /:id
  const sharedMatch = page.match(/^\/([a-f0-9]{8})$/);
  if (sharedMatch) {
    return (
      <>
        <SharedSummary
          id={sharedMatch[1]}
          onBack={() => navigate('/')}
          onChat={() => navigate(`/${sharedMatch[1]}/chat`)}
        />
        <ErrorDisplay />
      </>
    );
  }

  // Summary chat: /:id/chat
  const summaryChatMatch = page.match(/^\/([a-f0-9]{8})\/chat$/);
  if (summaryChatMatch) {
    return (
      <>
        <ChatPage summaryId={summaryChatMatch[1]} onBack={() => navigate(`/${summaryChatMatch[1]}`)} />
        <ErrorDisplay />
      </>
    );
  }

  // Chat page: /chat/:id
  const chatPageMatch = page.match(/^\/chat\/([a-f0-9]{8})$/);
  if (chatPageMatch) {
    return (
      <>
        <ChatPage id={chatPageMatch[1]} onBack={() => navigate('/')} />
        <ErrorDisplay />
      </>
    );
  }

  // Default: redirect to landing
  return (
    <>
      <LandingPage onGetStarted={() => navigate('/ytsummarise')} />
      <ErrorDisplay />
    </>
  );
}
