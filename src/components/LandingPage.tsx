import React from 'react';

interface LandingPageProps {
  onGetStarted: () => void;
}

function FadeInSection({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const [isVisible, setIsVisible] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -50px 0px' }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`fade-in-section ${isVisible ? 'visible' : ''} ${className}`}
      style={{ transitionDelay: delay ? `${delay * 0.1}s` : undefined }}
    >
      {children}
    </div>
  );
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const features = [
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="23 7 16 12 23 17 23 7"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
      ),
      title: 'Instant Summaries',
      description: 'Get AI-powered summaries of any YouTube video in seconds. No more watching long videos to get the key points.'
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      ),
      title: 'Smart Insights',
      description: 'Our AI extracts key takeaways, chapters, and highlights to give you a comprehensive overview.'
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      ),
      title: 'Interactive Chat',
      description: 'Have questions about the video? Chat with AI to dive deeper into any topic from the video.'
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      ),
      title: 'Free to Start',
      description: 'Get 500 free credits when you start. No signup required. Summarize videos instantly.'
    }
  ];

  const howItWorks = [
    { step: '1', title: 'Paste URL', description: 'Copy any YouTube video link' },
    { step: '2', title: 'AI Processes', description: 'Our AI analyzes the video content' },
    { step: '3', title: 'Get Summary', description: 'Receive a detailed summary instantly' }
  ];

  return (
    <div className="landing">
      <nav className="landing-nav">
        <FadeInSection>
          <span className="landing-brand">VidGist</span>
        </FadeInSection>
        <FadeInSection delay={1}>
          <button type="button" className="landing-cta-small" onClick={onGetStarted}>
            Try Now
          </button>
        </FadeInSection>
      </nav>

      <section className="hero-section">
        <FadeInSection>
          <h1 className="hero-title">
            Summarize YouTube Videos
            <span className="hero-title-accent"> in Seconds</span>
          </h1>
        </FadeInSection>
        <FadeInSection delay={1}>
          <p className="hero-sub">
            Paste a YouTube URL and get an AI-powered summary with key takeaways, 
            chapters, and insights. No more watching long videos to get the gist.
          </p>
        </FadeInSection>
        <FadeInSection delay={2}>
          <button type="button" className="landing-cta" onClick={onGetStarted}>
            <span>Start Summarizing</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        </FadeInSection>
        <FadeInSection delay={3}>
          <p className="hero-credits">500 free credits • No signup required</p>
        </FadeInSection>
      </section>

      <section className="features-section">
        <div className="features-grid">
          {features.map((feature, idx) => (
            <FadeInSection key={idx} delay={idx}>
              <div className="feature-card">
                <div className="feature-icon">{feature.icon}</div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-description">{feature.description}</p>
              </div>
            </FadeInSection>
          ))}
        </div>
      </section>

      <section className="how-it-works-section">
        <FadeInSection>
          <h2 className="section-title">How It Works</h2>
        </FadeInSection>
        <div className="steps-row">
          {howItWorks.map((item, idx) => (
            <FadeInSection key={idx} delay={idx}>
              <div className="step-item">
                <div className="step-number">{item.step}</div>
                <h3 className="step-title">{item.title}</h3>
                <p className="step-description">{item.description}</p>
              </div>
            </FadeInSection>
          ))}
        </div>
      </section>

      <section className="cta-section">
        <FadeInSection>
          <h2 className="cta-title">Ready to save time?</h2>
        </FadeInSection>
        <FadeInSection delay={1}>
          <p className="cta-sub">Start summarizing YouTube videos in seconds.</p>
        </FadeInSection>
        <FadeInSection delay={2}>
          <button type="button" className="landing-cta" onClick={onGetStarted}>
            <span>Get Started Free</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        </FadeInSection>
      </section>

      <footer className="landing-footer">
        <FadeInSection>
          <span>VidGist — AI-Powered YouTube Summaries</span>
        </FadeInSection>
      </footer>
    </div>
  );
}
