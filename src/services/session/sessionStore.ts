import { initDatabase, ensureUser as dbEnsureUser, getUserWallet, linkWallet } from '../database/postgres';

export interface SessionData {
  userId: string;
  walletAddress?: string;
  preferences?: {
    defaultGasBudget?: number;
    currency?: 'SUI' | 'USD';
  };
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  createdAt: Date;
  updatedAt: Date;
}

export class SessionStore {
  private sessions = new Map<string, SessionData>();
  private initialized = false;

  constructor() {
    // Initialize will be called on first use
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    try {
      initDatabase();
      this.initialized = true;
    } catch (err) {
      console.error('Failed to initialize database:', err);
    }
  }

  getOrCreate(userId: string, username?: string): SessionData {
    // Check in-memory cache first
    const cached = this.sessions.get(userId);
    if (cached) {
      cached.updatedAt = new Date();
      return cached;
    }

    const session: SessionData = {
      userId,
      history: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.sessions.set(userId, session);
    
    // Trigger async DB operations in background
    this.init().then(() => {
      dbEnsureUser(userId, username).catch(console.error);
      getUserWallet(userId).then(wallet => {
        if (wallet) {
          const s = this.sessions.get(userId);
          if (s) s.walletAddress = wallet;
        }
      }).catch(console.error);
    });

    return session;
  }

  appendHistory(userId: string, role: 'user' | 'assistant', text: string, maxMessages = 10) {
    const session = this.getOrCreate(userId);
    session.history.push({ role, text });
    if (session.history.length > maxMessages) {
      session.history.splice(0, session.history.length - maxMessages);
    }
    session.updatedAt = new Date();
  }

  async setWallet(
    userId: string,
    walletAddress: string,
    linkedVia: 'manual' | 'zklogin' | 'slush' | 'external' = 'manual'
  ): Promise<void> {
    await this.init();
    
    const session = this.getOrCreate(userId);
    session.walletAddress = walletAddress;
    session.updatedAt = new Date();

    // Persist to database
    await linkWallet(
      userId,
      walletAddress,
      linkedVia === 'zklogin' ? 'zklogin' : 'manual'
    );
  }

  getHistory(userId: string): Array<{ role: 'user' | 'assistant'; text: string }> {
    const session = this.sessions.get(userId);
    return session?.history || [];
  }

  clearHistory(userId: string): void {
    const session = this.sessions.get(userId);
    if (session) {
      session.history = [];
      session.updatedAt = new Date();
    }
  }

  getWallet(userId: string): string | undefined {
    return this.sessions.get(userId)?.walletAddress;
  }

  setPreferences(userId: string, preferences: SessionData['preferences']): void {
    const session = this.getOrCreate(userId);
    session.preferences = { ...session.preferences, ...preferences };
    session.updatedAt = new Date();
  }

  delete(userId: string): boolean {
    return this.sessions.delete(userId);
  }

  close() {
    // No-op for PostgreSQL (pool handles connections)
  }
}

// Singleton instance
export const sessionStore = new SessionStore();
